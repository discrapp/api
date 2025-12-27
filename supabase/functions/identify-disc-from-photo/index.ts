import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { withSentry } from '../_shared/with-sentry.ts';
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
  flight_numbers: {
    speed: number | null;
    glide: number | null;
    turn: number | null;
    fade: number | null;
  } | null;
  plastic: string | null;
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

const CLAUDE_PROMPT = `Analyze this disc golf disc image and identify it.

Look for:
- Manufacturer name/logo (common ones: Innova, Discraft, MVP, Axiom, Discmania, Dynamic Discs, Latitude 64, Westside, Kastaplast, Prodigy, Streamline, Thought Space Athletics, Lone Star Discs, Mint Discs, Clash Discs, Legacy, Gateway, Infinite Discs)
- Disc mold/model name on the stamp (e.g., Destroyer, Buzzz, Tesla, Reactor, PD2, Judge)
- Any flight numbers visible (4 numbers like 12/5/-1/3)
- Plastic type if visible (Champion, Star, ESP, Neutron, etc.)

IMPORTANT: Return ONLY a valid JSON object with no additional text, markdown, or explanation.

{
  "manufacturer": "string or null if unknown",
  "mold": "string or null if unknown",
  "flight_numbers": {"speed": N, "glide": N, "turn": N, "fade": N} or null,
  "plastic": "string or null if unknown",
  "confidence": 0.0-1.0,
  "visible_text": "describe all text/logos visible on the disc"
}

If you cannot identify the disc with reasonable certainty, set confidence below 0.5.
If you can identify the manufacturer but not the specific mold, set mold to null.`;

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
      return new Response(JSON.stringify({ error: 'AI identification failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
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
    const { error: logError } = await supabaseAdmin.from('ai_identification_logs').insert({
      user_id: user.id,
      ai_manufacturer: identification.manufacturer,
      ai_mold: identification.mold,
      ai_confidence: identification.confidence,
      ai_flight_numbers: identification.flight_numbers,
      ai_plastic: identification.plastic,
      ai_raw_response: {
        identification,
        catalog_match_id: catalogMatch?.id || null,
      },
      catalog_match_id: catalogMatch?.id || null,
      processing_time_ms: processingTime,
      model_version: 'claude-sonnet-4-20250514',
    });

    if (logError) {
      // Log but don't fail the request
      console.error('Failed to log identification:', logError);
    }

    return new Response(
      JSON.stringify({
        identification: {
          manufacturer: identification.manufacturer,
          mold: identification.mold,
          confidence: identification.confidence,
          raw_text: identification.visible_text,
          flight_numbers: identification.flight_numbers,
          plastic: identification.plastic,
        },
        catalog_match: catalogMatch,
        similar_matches: similarMatches,
        processing_time_ms: processingTime,
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

Deno.serve(withSentry(handler));
