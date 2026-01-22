import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { withSentry } from '../_shared/with-sentry.ts';
import { withRateLimit, RateLimitPresets } from '../_shared/with-rate-limit.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Identify Disc from Photo Function
 *
 * Uses Claude Vision API to identify disc golf discs from photos.
 * Returns manufacturer, mold, and flight numbers based on stamp analysis.
 *
 * POST /identify-disc-from-photo
 * Body: FormData with 'image' file
 *
 * Returns:
 * - identification: AI-identified disc info with confidence
 * - catalog_match: Matching disc from catalog (if found)
 * - similar_matches: Top 3 similar discs if no exact match
 */

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface ClaudeVisionResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
}

interface DiscIdentification {
  manufacturer: string | null;
  mold: string | null;
  disc_type: string | null;
  flight_numbers: {
    speed: number | null;
    glide: number | null;
    turn: number | null;
    fade: number | null;
  } | null;
  plastic: string | null;
  color: string | null;
  confidence: number;
  visible_text: string;
}

interface CatalogDisc {
  id: string;
  manufacturer: string;
  mold: string;
  category: string | null;
  speed: number | null;
  glide: number | null;
  turn: number | null;
  fade: number | null;
  stability: string | null;
}

const CLAUDE_PROMPT = `You are an expert disc golf disc identifier. ALWAYS make your best guess, even if worn/faded.

READ TEXT CAREFULLY - look for:
- Disc MODEL NAME (largest text, often in arc shape): Destroyer, Leopard, Buzzz, Teebird, etc.
- MANUFACTURER: Innova (star logo), Discraft, MVP, Discmania, Latitude 64, Dynamic Discs, Prodigy, Wild Discs, Westside Discs, Legacy Discs, Kastaplast, Thought Space Athletics
- PLASTIC TYPE (small text, separate from mold name): DX, Pro, Champion, Star, GStar, Halo, ESP, Z, Neutron, 400, 300, 750
- DISC TYPE (often printed on disc): Distance Driver, Fairway Driver, Midrange, Putter, Control Driver, Hybrid Driver, Approach

IMPORTANT - MOLD vs PLASTIC:
- Mold is JUST the disc name (e.g., "Rhyno", "Destroyer", "Buzzz")
- Do NOT include plastic in mold (wrong: "Champion Rhyno", right: mold="Rhyno", plastic="Champion")
- Do NOT include manufacturer in mold (wrong: "Innova Destroyer", right: manufacturer="Innova", mold="Destroyer")

PRODIGY NAMING - Their discs use this format:
- D = Distance Driver (D1, D2, D3, D4, D Model S, D Model OS, D Model US)
- F = Fairway Driver (F1, F2, F3, F5, F7, F Model S, F Model OS)
- M = Midrange (M1, M2, M3, M4, M Model S, M Model US)
- P = Putter (PA-1, PA-2, PA-3, PA-4, PA-5, P Model S, P Model OS, P Model US)
- Look for "MODEL" text to distinguish P Model S from PA-3

COMMON DISCS BY BRAND:
Innova: Destroyer, Wraith, Firebird, Thunderbird, Valkyrie, Leopard, Teebird, Eagle, IT, Boss, Roc3, Mako3, Aviar, Pig, Rhyno
Discraft: Zeus, Nuke, Force, Undertaker, Buzzz, Zone, Luna, Meteor, Heat
MVP/Axiom: Tesla, Volt, Reactor, Hex, Envy, Proxy, Crave, Insanity
Discmania: DD3, CD1, CD2, CD3, PD, PD2, FD, FD3, MD3, P2, Sensei (Note: CD1 and CD2 are DIFFERENT discs)
Prodigy: D1, D2, D3, F1, F2, F3, F5, M1, M2, M3, M4, PA-3, P Model S, P Model OS
Dynamic Discs: Felon, Trespass, Escape, Maverick, Emac Truth, Judge
Latitude 64: Compass, Explorer, River, Saint, Grace, Pure
Westside Discs: Tursas, Hatchet, Sword, World, Harp
Wild Discs: Angler, Sea Otter

Return ONLY this JSON (no other text):
{"manufacturer":"string","mold":"string","disc_type":"Distance Driver|Fairway Driver|Midrange|Putter|Control Driver|Hybrid Driver|Approach|null","flight_numbers":{"speed":N,"glide":N,"turn":N,"fade":N},"plastic":"string or null","color":"Red|Orange|Yellow|Green|Blue|Purple|Pink|White|Black|Gray|Multi","confidence":0.0-1.0,"visible_text":"describe all text/logos seen"}

IMPORTANT: ALWAYS guess manufacturer and mold. Spell out partial letters you see. Users can correct mistakes. If disc type is printed on the disc, include it in disc_type.`;

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
    return new Response(JSON.stringify({ error: 'AI identification not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();

  try {
    // Convert file to base64 using Deno's standard encoding
    // Note: btoa with spread operator fails for large files due to call stack limits
    const arrayBuffer = await file.arrayBuffer();
    const base64 = encodeBase64(new Uint8Array(arrayBuffer));

    // Map MIME type to Claude's expected format
    const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp';

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
                text: CLAUDE_PROMPT,
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
        operation: 'identify-disc-from-photo',
        statusCode: claudeResponse.status,
        errorText,
      });
      // Return detailed error for debugging
      return new Response(
        JSON.stringify({
          error: 'AI identification failed',
          details: `Claude API returned ${claudeResponse.status}: ${errorText.substring(0, 500)}`,
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
      return new Response(JSON.stringify({ error: 'AI returned no identification' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse the JSON response from Claude
    let identification: DiscIdentification;
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

      identification = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', textContent.text);
      captureException(parseError, {
        operation: 'identify-disc-from-photo',
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

    // Search for matching disc in catalog
    let catalogMatch: CatalogDisc | null = null;
    let similarMatches: CatalogDisc[] = [];

    if (identification.manufacturer && identification.mold) {
      // Try exact match first
      const { data: exactMatch } = await supabase
        .from('disc_catalog')
        .select('id, manufacturer, mold, category, speed, glide, turn, fade, stability')
        .ilike('manufacturer', identification.manufacturer)
        .ilike('mold', identification.mold)
        .eq('status', 'verified')
        .limit(1)
        .single();

      if (exactMatch) {
        catalogMatch = exactMatch;
      } else {
        // Search for similar matches
        const searchPattern = `%${identification.mold}%`;
        const { data: similar } = await supabase
          .from('disc_catalog')
          .select('id, manufacturer, mold, category, speed, glide, turn, fade, stability')
          .or(`mold.ilike.${searchPattern},manufacturer.ilike.%${identification.manufacturer}%`)
          .eq('status', 'verified')
          .limit(3);

        similarMatches = similar || [];
      }
    } else if (identification.mold) {
      // Only mold identified, search by mold
      const searchPattern = `%${identification.mold}%`;
      const { data: similar } = await supabase
        .from('disc_catalog')
        .select('id, manufacturer, mold, category, speed, glide, turn, fade, stability')
        .ilike('mold', searchPattern)
        .eq('status', 'verified')
        .limit(3);

      similarMatches = similar || [];
      if (similarMatches.length === 1) {
        catalogMatch = similarMatches[0];
        similarMatches = [];
      }
    }

    // Create service role client for logging
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Log the identification attempt
    const { data: logData, error: logError } = await supabaseAdmin
      .from('ai_identification_logs')
      .insert({
        user_id: user.id,
        ai_manufacturer: identification.manufacturer,
        ai_mold: identification.mold,
        ai_confidence: identification.confidence,
        ai_flight_numbers: identification.flight_numbers,
        ai_plastic: identification.plastic,
        ai_color: identification.color,
        ai_raw_response: {
          identification,
          catalog_match_id: catalogMatch?.id || null,
        },
        catalog_match_id: catalogMatch?.id || null,
        processing_time_ms: processingTime,
        model_version: 'claude-sonnet-4-20250514',
      })
      .select('id')
      .single();

    if (logError) {
      // Log but don't fail the request
      console.error('Failed to log identification:', logError);
    }

    return new Response(
      JSON.stringify({
        identification: {
          manufacturer: identification.manufacturer,
          mold: identification.mold,
          disc_type: identification.disc_type,
          confidence: identification.confidence,
          raw_text: identification.visible_text,
          flight_numbers: identification.flight_numbers,
          plastic: identification.plastic,
          color: identification.color,
        },
        catalog_match: catalogMatch,
        similar_matches: similarMatches,
        processing_time_ms: processingTime,
        log_id: logData?.id || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Identification error:', error);
    captureException(error, {
      operation: 'identify-disc-from-photo',
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Identification failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(withRateLimit(handler, RateLimitPresets.expensive)));
