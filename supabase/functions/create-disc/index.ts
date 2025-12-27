import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';

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
  if (flightNumbers.turn < -5 || flightNumbers.turn > 1) {
    return 'Turn must be between -5 and 1';
  }
  if (flightNumbers.fade < 0 || flightNumbers.fade > 5) {
    return 'Fade must be between 0 and 5';
  }
  return null;
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

  // Parse request body
  let body: CreateDiscRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.mold || body.mold.trim() === '') {
    return new Response(JSON.stringify({ error: 'Mold is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.flight_numbers) {
    return new Response(JSON.stringify({ error: 'Flight numbers are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate flight numbers
  const flightNumbersError = validateFlightNumbers(body.flight_numbers);
  if (flightNumbersError) {
    return new Response(JSON.stringify({ error: flightNumbersError }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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
    return new Response(JSON.stringify({ error: 'Failed to create disc', details: dbError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
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
      // Check if user made any corrections
      const wasCorrected =
        (aiLog.ai_manufacturer || '') !== (body.manufacturer || '') ||
        (aiLog.ai_mold || '') !== (body.mold || '') ||
        (aiLog.ai_plastic || '') !== (body.plastic || '') ||
        (aiLog.ai_color || '') !== (body.color || '');

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
