import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import ExifReader from 'https://esm.sh/exifreader@4.14.1';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Shot Recommendation Function
 *
 * Uses Claude Vision API to analyze a disc golf hole photo and recommend
 * the best disc from the user's bag with full shot breakdown.
 *
 * POST /get-shot-recommendation
 * Body: FormData with 'image' file
 *
 * Returns:
 * - recommendation: Primary disc recommendation with throw details
 * - terrain_analysis: AI analysis of the hole (distance, elevation, obstacles)
 * - alternatives: Alternative disc options with reasoning
 * - confidence: AI confidence in the recommendation
 */

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const NEARBY_RADIUS_METERS = 4.57; // 15 feet in meters

interface ClaudeVisionResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
}

interface FlightNumbers {
  speed: number;
  glide: number;
  turn: number;
  fade: number;
}

interface UserDisc {
  id: string;
  name: string | null;
  manufacturer: string | null;
  mold: string | null;
  color: string | null;
  flight_numbers: FlightNumbers | null;
}

interface FlightPathCoordinates {
  tee_position: { x: number; y: number };
  basket_position: { x: number; y: number };
  basket_visible?: boolean;
}

interface GpsCoordinates {
  latitude: number;
  longitude: number;
}

interface NearbyCorrection {
  corrected_tee_position: { x: number; y: number };
  corrected_basket_position: { x: number; y: number };
}

/**
 * Extracts GPS coordinates from image EXIF data
 */
function extractGpsFromExif(arrayBuffer: ArrayBuffer): GpsCoordinates | null {
  try {
    const tags = ExifReader.load(arrayBuffer);

    const latitudeTag = tags['GPSLatitude'];
    const longitudeTag = tags['GPSLongitude'];
    const latitudeRef = tags['GPSLatitudeRef'];
    const longitudeRef = tags['GPSLongitudeRef'];

    if (!latitudeTag || !longitudeTag) {
      return null;
    }

    // ExifReader returns the value in degrees as a number
    let latitude = latitudeTag.description ? parseFloat(latitudeTag.description as string) : null;
    let longitude = longitudeTag.description ? parseFloat(longitudeTag.description as string) : null;

    if (latitude === null || longitude === null || isNaN(latitude) || isNaN(longitude)) {
      return null;
    }

    // Apply reference direction
    const latRef = latitudeRef?.value;
    const lonRef = longitudeRef?.value;
    if (typeof latRef === 'string' && latRef === 'S') {
      latitude = -latitude;
    } else if (Array.isArray(latRef) && latRef[0] === 'S') {
      latitude = -latitude;
    }
    if (typeof lonRef === 'string' && lonRef === 'W') {
      longitude = -longitude;
    } else if (Array.isArray(lonRef) && lonRef[0] === 'W') {
      longitude = -longitude;
    }

    return { latitude, longitude };
  } catch (error) {
    console.error('EXIF extraction error:', error);
    return null;
  }
}

/**
 * Calculates distance between two GPS coordinates in meters using Haversine formula
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates the average of multiple position corrections
 */
function averageCorrections(corrections: NearbyCorrection[]): NearbyCorrection {
  const count = corrections.length;
  const sumTee = { x: 0, y: 0 };
  const sumBasket = { x: 0, y: 0 };

  for (const c of corrections) {
    sumTee.x += c.corrected_tee_position.x;
    sumTee.y += c.corrected_tee_position.y;
    sumBasket.x += c.corrected_basket_position.x;
    sumBasket.y += c.corrected_basket_position.y;
  }

  return {
    corrected_tee_position: {
      x: Math.round((sumTee.x / count) * 10) / 10,
      y: Math.round((sumTee.y / count) * 10) / 10,
    },
    corrected_basket_position: {
      x: Math.round((sumBasket.x / count) * 10) / 10,
      y: Math.round((sumBasket.y / count) * 10) / 10,
    },
  };
}

interface ShotRecommendation {
  estimated_distance_ft: number;
  confidence: number;
  terrain: {
    elevation_change: 'uphill' | 'downhill' | 'flat';
    obstacles: string;
    fairway_shape: 'straight' | 'dogleg_left' | 'dogleg_right' | 'open';
  };
  recommendation: {
    disc_id: string;
    disc_name: string;
    throw_type: 'hyzer' | 'flat' | 'anhyzer';
    power_percentage: number;
    line_description: string;
  };
  alternatives: Array<{
    disc_id: string;
    disc_name: string;
    throw_type: string;
    reason: string;
  }>;
  flight_path: FlightPathCoordinates;
  analysis_notes: string;
}

function buildClaudePrompt(
  discs: UserDisc[],
  throwingHand: 'right' | 'left',
  nearbyCorrection?: NearbyCorrection
): string {
  const discList = discs
    .map((d) => {
      const name = d.mold || d.name || 'Unknown';
      const manufacturer = d.manufacturer || 'Unknown';
      const fn = d.flight_numbers;
      const flightNumbers = fn ? `${fn.speed}/${fn.glide}/${fn.turn}/${fn.fade}` : 'N/A';
      return `- ${name} (${manufacturer}): ${flightNumbers} [ID: ${d.id}]`;
    })
    .join('\n');

  // Build position hint from nearby corrections
  const positionHint = nearbyCorrection
    ? `
IMPORTANT - LEARNED POSITION DATA:
Previous users at this exact location have corrected the positions to:
- Tee position: x=${nearbyCorrection.corrected_tee_position.x}, y=${nearbyCorrection.corrected_tee_position.y}
- Basket position: x=${nearbyCorrection.corrected_basket_position.x}, y=${nearbyCorrection.corrected_basket_position.y}
Use these as your starting point, but adjust if the photo perspective is clearly different.
`
    : '';

  return `Analyze this disc golf hole photo and return ONLY a JSON object. No explanatory text.
${positionHint}
BASKET POSITION RULES:
- Trees are NOT the basket. The basket is TINY (a few pixels) compared to trees.
- If water/lake is on LEFT: basket x: 90-95 (very far right edge), y: 40-50 (grass horizon)
- If water/lake is on RIGHT: basket x: 5-10 (very far left edge), y: 40-50 (grass horizon)
- The basket sits ON THE GRASS where grass meets the horizon/tree line, NOT in the sky
- Y should be where the green grass is, typically 40-55, NOT above 35
- Set basket_visible:false since the basket is usually too small to see clearly

DISC SELECTION:
Throwing hand: ${throwingHand} (backhand fades ${throwingHand === 'right' ? 'left' : 'right'})
Available discs:
${discList}

RESPOND WITH ONLY THIS JSON:
{
  "estimated_distance_ft": <number>,
  "confidence": <0.0-1.0>,
  "terrain": {
    "elevation_change": "uphill|downhill|flat",
    "obstacles": "<description of obstacles>",
    "fairway_shape": "straight|dogleg_left|dogleg_right|open"
  },
  "recommendation": {
    "disc_id": "<uuid from bag>",
    "disc_name": "<mold name>",
    "throw_type": "hyzer|flat|anhyzer",
    "power_percentage": <50-100>,
    "line_description": "<specific throwing instructions>"
  },
  "alternatives": [
    {
      "disc_id": "<uuid>",
      "disc_name": "<mold>",
      "throw_type": "hyzer|flat|anhyzer",
      "reason": "<why this is an alternative>"
    }
  ],
  "flight_path": {
    "tee_position": { "x": <0-100>, "y": <0-100> },
    "basket_position": { "x": <0-100>, "y": <0-100> },
    "basket_visible": <true if you can SEE the basket, false if estimated>
  },
  "analysis_notes": "<brief analysis>"
}`;
}

const handler = async (req: Request): Promise<Response> => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // Verify user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Set Sentry user context
  setUser(user.id);

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Extract image file
  const file = formData.get('image') as File;

  if (!file) {
    return new Response(JSON.stringify({ error: 'image is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return new Response(JSON.stringify({ error: 'File must be an image (jpeg, png, or webp)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: 'File size must be less than 5MB' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for Anthropic API key
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'AI recommendation not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch user's discs (without photos - will fetch separately to avoid RLS join issues)
  const { data: userDiscs, error: discsError } = await supabase
    .from('discs')
    .select('id, name, manufacturer, mold, color, flight_numbers')
    .eq('owner_id', user.id);

  if (discsError) {
    console.error('Failed to fetch user discs:', discsError);
    captureException(new Error('Failed to fetch user discs'), {
      operation: 'get-shot-recommendation',
      userId: user.id,
      error: discsError,
    });
    return new Response(JSON.stringify({ error: 'Failed to fetch disc bag' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!userDiscs || userDiscs.length === 0) {
    return new Response(JSON.stringify({ error: 'No discs in bag. Add discs to get shot recommendations.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch user's throwing hand (default to right if not set)
  const { data: profile } = await supabase.from('profiles').select('throwing_hand').eq('id', user.id).single();

  const throwingHand: 'right' | 'left' = profile?.throwing_hand ?? 'right';

  // Create service role client for storage operations and logging
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Helper to get signed URL for a disc's profile photo (fetches photo separately to avoid RLS join issues)
  async function getDiscPhotoUrl(discId: string): Promise<string | null> {
    // Fetch profile photo using service role to bypass RLS
    const { data: photos } = await supabaseAdmin
      .from('disc_photos')
      .select('storage_path')
      .eq('disc_id', discId)
      .eq('photo_type', 'profile')
      .limit(1);

    if (!photos || photos.length === 0) return null;

    const { data: urlData } = await supabaseAdmin.storage
      .from('disc-photos')
      .createSignedUrl(photos[0].storage_path, 3600); // 1 hour expiry

    return urlData?.signedUrl || null;
  }

  const startTime = Date.now();

  try {
    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = encodeBase64(new Uint8Array(arrayBuffer));

    // Map MIME type to Claude's expected format
    const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp';

    // Extract GPS coordinates from EXIF data
    const gpsCoords = extractGpsFromExif(arrayBuffer);

    // Query for nearby corrections if we have GPS data
    let nearbyCorrection: NearbyCorrection | undefined;
    if (gpsCoords) {
      // Calculate bounding box for initial filtering (~50m to be safe, then filter by distance)
      const latDelta = 0.0005; // ~55m
      const lonDelta = 0.0005 / Math.cos((gpsCoords.latitude * Math.PI) / 180);

      const { data: nearbyLogs } = await supabaseAdmin
        .from('shot_recommendation_logs')
        .select('photo_latitude, photo_longitude, corrected_tee_position, corrected_basket_position')
        .not('corrected_tee_position', 'is', null)
        .not('corrected_basket_position', 'is', null)
        .not('photo_latitude', 'is', null)
        .not('photo_longitude', 'is', null)
        .gte('photo_latitude', gpsCoords.latitude - latDelta)
        .lte('photo_latitude', gpsCoords.latitude + latDelta)
        .gte('photo_longitude', gpsCoords.longitude - lonDelta)
        .lte('photo_longitude', gpsCoords.longitude + lonDelta);

      if (nearbyLogs && nearbyLogs.length > 0) {
        // Filter by actual distance (15 feet / 4.57m)
        const nearbyCorrections = nearbyLogs.filter((log) => {
          const distance = haversineDistance(
            gpsCoords.latitude,
            gpsCoords.longitude,
            log.photo_latitude!,
            log.photo_longitude!
          );
          return distance <= NEARBY_RADIUS_METERS;
        });

        if (nearbyCorrections.length > 0) {
          // Average the corrections from nearby photos
          nearbyCorrection = averageCorrections(
            nearbyCorrections.map((log) => ({
              corrected_tee_position: log.corrected_tee_position as { x: number; y: number },
              corrected_basket_position: log.corrected_basket_position as { x: number; y: number },
            }))
          );
          console.log(`Found ${nearbyCorrections.length} nearby corrections within 15ft, using averaged positions`);
        }
      }
    }

    // Build prompt with user's disc bag and any nearby corrections
    const prompt = buildClaudePrompt(userDiscs, throwingHand, nearbyCorrection);

    // Call Claude Vision API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', claudeResponse.status, errorText);
      captureException(new Error(`Claude API error: ${claudeResponse.status}`), {
        operation: 'get-shot-recommendation',
        statusCode: claudeResponse.status,
        errorText,
      });
      return new Response(
        JSON.stringify({
          error: 'AI recommendation failed',
          details: `Claude API returned ${claudeResponse.status}`,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const claudeData: ClaudeVisionResponse = await claudeResponse.json();
    const processingTime = Date.now() - startTime;

    // Extract the text response
    const textContent = claudeData.content.find((c) => c.type === 'text');
    if (!textContent?.text) {
      console.error('No text response from Claude');
      return new Response(JSON.stringify({ error: 'AI returned no recommendation' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse the JSON response from Claude
    let recommendation: ShotRecommendation;
    try {
      // Claude might wrap response in markdown code blocks, so clean it
      let jsonText = textContent.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      jsonText = jsonText.trim();

      recommendation = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', textContent.text);
      captureException(parseError, {
        operation: 'get-shot-recommendation',
        rawResponse: textContent.text,
      });
      return new Response(
        JSON.stringify({
          error: 'AI response could not be parsed',
          raw_response: textContent.text,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Find the recommended disc details
    const recommendedDisc = userDiscs.find((d) => d.id === recommendation.recommendation.disc_id);

    // Log the recommendation (include GPS if available)
    const { data: logData, error: logError } = await supabaseAdmin
      .from('shot_recommendation_logs')
      .insert({
        user_id: user.id,
        ai_estimated_distance_ft: recommendation.estimated_distance_ft,
        ai_confidence: recommendation.confidence,
        ai_terrain_analysis: recommendation.terrain,
        ai_raw_response: recommendation,
        recommended_disc_id: recommendation.recommendation.disc_id,
        recommended_throw_type: recommendation.recommendation.throw_type,
        recommended_power_percentage: recommendation.recommendation.power_percentage,
        recommended_line_description: recommendation.recommendation.line_description,
        alternative_recommendations: recommendation.alternatives,
        processing_time_ms: processingTime,
        model_version: 'claude-sonnet-4-20250514',
        photo_latitude: gpsCoords?.latitude ?? null,
        photo_longitude: gpsCoords?.longitude ?? null,
      })
      .select('id')
      .single();

    if (logError) {
      // Log but don't fail the request
      console.error('Failed to log recommendation:', logError);
    }

    // Build alternatives with full disc details and photos
    const alternatives = await Promise.all(
      recommendation.alternatives.map(async (alt) => {
        const altDisc = userDiscs.find((d) => d.id === alt.disc_id);
        const photoUrl = altDisc ? await getDiscPhotoUrl(altDisc.id) : null;
        return {
          disc: altDisc
            ? {
                id: altDisc.id,
                name: altDisc.mold || altDisc.name,
                manufacturer: altDisc.manufacturer,
                color: altDisc.color,
                flight_numbers: altDisc.flight_numbers,
                photo_url: photoUrl,
              }
            : {
                id: alt.disc_id,
                name: alt.disc_name,
                manufacturer: null,
                color: null,
                flight_numbers: null,
                photo_url: null,
              },
          throw_type: alt.throw_type,
          reason: alt.reason,
        };
      })
    );

    // Get photo URL for recommended disc
    const recommendedDiscPhotoUrl = recommendedDisc ? await getDiscPhotoUrl(recommendedDisc.id) : null;

    return new Response(
      JSON.stringify({
        recommendation: {
          disc: recommendedDisc
            ? {
                id: recommendedDisc.id,
                name: recommendedDisc.mold || recommendedDisc.name,
                manufacturer: recommendedDisc.manufacturer,
                color: recommendedDisc.color,
                flight_numbers: recommendedDisc.flight_numbers,
                photo_url: recommendedDiscPhotoUrl,
              }
            : null,
          throw_type: recommendation.recommendation.throw_type,
          power_percentage: recommendation.recommendation.power_percentage,
          line_description: recommendation.recommendation.line_description,
        },
        terrain_analysis: {
          estimated_distance_ft: recommendation.estimated_distance_ft,
          elevation_change: recommendation.terrain.elevation_change,
          obstacles: recommendation.terrain.obstacles,
          fairway_shape: recommendation.terrain.fairway_shape,
        },
        alternatives,
        confidence: recommendation.confidence,
        flight_path: recommendation.flight_path || null,
        processing_time_ms: processingTime,
        log_id: logData?.id || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Recommendation error:', error);
    captureException(error, {
      operation: 'get-shot-recommendation',
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Recommendation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
