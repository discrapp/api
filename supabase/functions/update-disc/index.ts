import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

interface FlightNumbers {
  speed: number;
  glide: number;
  turn: number;
  fade: number;
  stability?: number;
}

interface UpdateDiscRequest {
  disc_id: string;
  manufacturer?: string;
  mold?: string;
  plastic?: string;
  weight?: number;
  color?: string;
  flight_numbers?: FlightNumbers;
  reward_amount?: number;
  notes?: string;
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
  // Only allow PUT requests
  if (req.method !== 'PUT') {
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

  // Parse request body
  let body: UpdateDiscRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.disc_id || body.disc_id.trim() === '') {
    return new Response(JSON.stringify({ error: 'disc_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the disc exists and belongs to the user
  const { data: existingDisc, error: fetchError } = await supabase
    .from('discs')
    .select('id, owner_id')
    .eq('id', body.disc_id)
    .single();

  if (fetchError || !existingDisc) {
    return new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (existingDisc.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden: You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate flight numbers if provided
  if (body.flight_numbers) {
    const flightNumbersError = validateFlightNumbers(body.flight_numbers);
    if (flightNumbersError) {
      return new Response(JSON.stringify({ error: flightNumbersError }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Build update object (only include provided fields)
  const updateData: Record<string, string | number | FlightNumbers> = {
    updated_at: new Date().toISOString(),
  };

  if (body.mold !== undefined) {
    updateData.mold = body.mold;
    updateData.name = body.mold; // Keep name in sync with mold
  }
  if (body.manufacturer !== undefined) updateData.manufacturer = body.manufacturer;
  if (body.plastic !== undefined) updateData.plastic = body.plastic;
  if (body.weight !== undefined) updateData.weight = body.weight;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.flight_numbers !== undefined) updateData.flight_numbers = body.flight_numbers;
  if (body.reward_amount !== undefined) updateData.reward_amount = body.reward_amount;
  if (body.notes !== undefined) updateData.notes = body.notes;

  // Update disc
  const { data: disc, error: updateError } = await supabase
    .from('discs')
    .update(updateData)
    .eq('id', body.disc_id)
    .select()
    .single();

  if (updateError) {
    console.error('Database error:', updateError);
    captureException(updateError, {
      operation: 'update-disc',
      discId: body.disc_id,
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Failed to update disc', details: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(disc), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

Deno.serve(withSentry(handler));
