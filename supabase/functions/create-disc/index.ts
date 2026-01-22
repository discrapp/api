import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { methodNotAllowed, unauthorized, badRequest, internalError, ErrorCode } from '../_shared/error-response.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

interface FlightNumbers {
  speed: number;
  glide: number;
  turn: number;
  fade: number;
  stability?: number;
}

interface CreateDiscRequest {
  manufacturer?: string;
  mold: string;
  plastic?: string;
  weight?: number;
  color?: string;
  category?: string;
  flight_numbers: FlightNumbers;
  reward_amount?: number;
  notes?: string;
  qr_code_id?: string;
  ai_identification_log_id?: string;
}

function validateFlightNumbers(flightNumbers: FlightNumbers): string | null {
  if (flightNumbers.speed < 1 || flightNumbers.speed > 14) {
    return 'Speed must be between 1 and 14';
  }
  if (flightNumbers.glide < 1 || flightNumbers.glide > 7) {
    return 'Glide must be between 1 and 7';
  }
  if (flightNumbers.turn < -5 || flightNumbers.turn > 5) {
    return 'Turn must be between -5 and 5';
  }
  if (flightNumbers.fade < 0 || flightNumbers.fade > 5) {
    return 'Fade must be between 0 and 5';
  }
  return null;
}

const handler = async (req: Request): Promise<Response> => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return methodNotAllowed();
  }

  // Check authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return unauthorized('Missing authorization header');
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
    return unauthorized('Unauthorized', ErrorCode.INVALID_AUTH);
  }

  // Set Sentry user context
  setUser(user.id);

  // Parse request body
  let body: CreateDiscRequest;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body', ErrorCode.INVALID_JSON);
  }

  // Validate required fields
  if (!body.mold || body.mold.trim() === '') {
    return badRequest('Mold is required', ErrorCode.MISSING_FIELD, { field: 'mold' });
  }

  if (!body.flight_numbers) {
    return badRequest('Flight numbers are required', ErrorCode.MISSING_FIELD, {
      field: 'flight_numbers',
    });
  }

  // Validate flight numbers
  const flightNumbersError = validateFlightNumbers(body.flight_numbers);
  if (flightNumbersError) {
    return badRequest(flightNumbersError, ErrorCode.INVALID_FIELD, { field: 'flight_numbers' });
  }

  // Create disc (use mold as name)
  const { data: disc, error: dbError } = await supabase
    .from('discs')
    .insert({
      owner_id: user.id,
      name: body.mold, // Use mold as the disc name
      manufacturer: body.manufacturer,
      mold: body.mold,
      plastic: body.plastic,
      weight: body.weight,
      color: body.color,
      category: body.category,
      flight_numbers: body.flight_numbers,
      reward_amount: body.reward_amount,
      notes: body.notes,
      qr_code_id: body.qr_code_id,
      ai_identification_log_id: body.ai_identification_log_id,
    })
    .select()
    .single();

  if (dbError) {
    console.error('Database error:', dbError);
    captureException(dbError, {
      operation: 'create-disc',
      userId: user.id,
    });
    return internalError('Failed to create disc', ErrorCode.DATABASE_ERROR, {
      message: dbError.message,
    });
  }

  // If this disc was created from AI identification, update the log with corrections
  if (body.ai_identification_log_id) {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Get the original AI identification to compare
    const { data: aiLog } = await supabaseAdmin
      .from('ai_identification_logs')
      .select('ai_manufacturer, ai_mold, ai_plastic, ai_color')
      .eq('id', body.ai_identification_log_id)
      .single();

    if (aiLog) {
      // Helper to normalize strings for comparison (case-insensitive, trimmed)
      const normalize = (s: string | null | undefined): string => (s || '').toLowerCase().trim();

      // Helper to check if two values are effectively the same
      // Handles cases like "Champion Rhyno" matching "Rhyno" or "Westside" matching "Westside Discs"
      const isSameValue = (ai: string | null | undefined, user: string | null | undefined): boolean => {
        const aiNorm = normalize(ai);
        const userNorm = normalize(user);
        if (aiNorm === userNorm) return true;
        if (!aiNorm || !userNorm) return aiNorm === userNorm;
        // Check if one contains the other (handles "Champion Rhyno" vs "Rhyno")
        return aiNorm.includes(userNorm) || userNorm.includes(aiNorm);
      };

      // Check if user made any REAL corrections (not just formatting differences)
      const wasCorrected =
        !isSameValue(aiLog.ai_manufacturer, body.manufacturer) ||
        !isSameValue(aiLog.ai_mold, body.mold) ||
        !isSameValue(aiLog.ai_plastic, body.plastic) ||
        !isSameValue(aiLog.ai_color, body.color);

      // Update the log with user's final values and correction status
      await supabaseAdmin
        .from('ai_identification_logs')
        .update({
          disc_id: disc.id,
          user_manufacturer: body.manufacturer,
          user_mold: body.mold,
          user_plastic: body.plastic,
          user_color: body.color,
          was_corrected: wasCorrected,
        })
        .eq('id', body.ai_identification_log_id);
    }
  }

  return new Response(JSON.stringify(disc), { status: 201, headers: { 'Content-Type': 'application/json' } });
};

Deno.serve(withSentry(handler));
