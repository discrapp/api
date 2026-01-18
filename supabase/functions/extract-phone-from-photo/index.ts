import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { withSentry } from '../_shared/with-sentry.ts';
import { withRateLimit, RateLimitPresets } from '../_shared/with-rate-limit.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Extract Phone from Photo Function
 *
 * Uses Claude Vision API to extract phone numbers from disc photos.
 * Analyzes both front (for disc identification) and back (for phone number).
 *
 * POST /extract-phone-from-photo
 * Body: FormData with 'back_image' (required) and 'front_image' (required)
 *
 * Returns:
 * - phone_numbers: Array of extracted phone numbers with confidence
 * - disc_info: Identified disc manufacturer/mold from front image
 * - processing_time_ms: Time taken for extraction
 */

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per image

interface PhoneNumber {
  raw: string;
  normalized: string;
  confidence: number;
}

interface DiscInfo {
  manufacturer: string | null;
  mold: string | null;
  color: string | null;
  plastic: string | null;
}

interface ExtractionResult {
  phone_numbers: PhoneNumber[];
  disc_info: DiscInfo;
  other_text: string;
}

interface ClaudeVisionResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
}

const CLAUDE_PROMPT = `You are analyzing disc golf disc photos to find the owner's phone number and identify the disc.

BACK IMAGE - Look for phone numbers:
- 10-digit US phone numbers in any format: (XXX) XXX-XXXX, XXX-XXX-XXXX, XXX.XXX.XXXX, XXXXXXXXXX
- Usually handwritten with Sharpie marker
- May be faded, smudged, or partially obscured
- Numbers are often centered on the disc back

FRONT IMAGE - Identify the disc:
- Manufacturer: Innova (star logo), Discraft, MVP/Axiom, Discmania, Latitude 64, Dynamic Discs, Kastaplast
- Mold name: The largest text, often in an arc (e.g., Destroyer, Buzzz, Volt)
- Plastic type: Small text like DX, Pro, Champion, Star, ESP, Z, Neutron
- Color of the disc

Return ONLY this JSON (no other text):
{
  "phone_numbers": [
    {"raw": "format as written", "normalized": "+1XXXXXXXXXX", "confidence": 0.0-1.0}
  ],
  "disc_info": {
    "manufacturer": "brand name or null",
    "mold": "disc model or null",
    "color": "disc color",
    "plastic": "plastic type or null"
  },
  "other_text": "any other visible text (names, course names, etc.)"
}

PHONE NUMBER CONFIDENCE:
- 1.0: All 10 digits clearly visible
- 0.8-0.9: 9-10 digits visible, 1 unclear
- 0.6-0.7: 7-8 digits visible
- Below 0.5: Don't include

IMPORTANT:
- Normalize US phone numbers to E.164 format (+1XXXXXXXXXX)
- If no phone number visible, return empty array
- ALWAYS attempt disc identification from the front image
- Include all phone numbers found (some discs have multiple)`;

function validateFile(file: File | null, fieldName: string): Response | null {
  if (!file) {
    return new Response(JSON.stringify({ error: `${fieldName} is required` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return new Response(JSON.stringify({ error: `${fieldName} must be an image (jpeg, png, or webp)` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (file.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: `${fieldName} size must be less than 5MB` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = encodeBase64(new Uint8Array(arrayBuffer));
  return {
    base64,
    mediaType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
  };
}

function parseClaudeResponse(text: string): ExtractionResult {
  // Clean up markdown code blocks if present
  let jsonText = text.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  const parsed = JSON.parse(jsonText);

  // Ensure proper structure
  return {
    phone_numbers: Array.isArray(parsed.phone_numbers) ? parsed.phone_numbers : [],
    disc_info: {
      manufacturer: parsed.disc_info?.manufacturer || null,
      mold: parsed.disc_info?.mold || null,
      color: parsed.disc_info?.color || null,
      plastic: parsed.disc_info?.plastic || null,
    },
    other_text: parsed.other_text || '',
  };
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

  // Extract and validate images
  const backImage = formData.get('back_image') as File;
  const frontImage = formData.get('front_image') as File;

  const backError = validateFile(backImage, 'back_image');
  if (backError) return backError;

  const frontError = validateFile(frontImage, 'front_image');
  if (frontError) return frontError;

  // Check for Anthropic API key
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'Phone extraction not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();

  try {
    // Convert both images to base64
    const backImageData = await fileToBase64(backImage);
    const frontImageData = await fileToBase64(frontImage);

    // Call Claude Vision API with both images
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
                type: 'text',
                text: 'BACK OF DISC (look for phone number):',
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: backImageData.mediaType,
                  data: backImageData.base64,
                },
              },
              {
                type: 'text',
                text: 'FRONT OF DISC (identify the disc):',
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: frontImageData.mediaType,
                  data: frontImageData.base64,
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
        operation: 'extract-phone-from-photo',
        statusCode: claudeResponse.status,
        errorText,
      });
      return new Response(
        JSON.stringify({
          error: 'Phone extraction failed',
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
      return new Response(JSON.stringify({ error: 'AI returned no extraction result' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse the JSON response from Claude
    let extraction: ExtractionResult;
    try {
      extraction = parseClaudeResponse(textContent.text);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', textContent.text);
      captureException(parseError, {
        operation: 'extract-phone-from-photo',
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

    return new Response(
      JSON.stringify({
        success: true,
        phone_numbers: extraction.phone_numbers,
        disc_info: extraction.disc_info,
        other_text: extraction.other_text,
        processing_time_ms: processingTime,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Extraction error:', error);
    captureException(error, {
      operation: 'extract-phone-from-photo',
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Phone extraction failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(withRateLimit(handler, RateLimitPresets.expensive)));
