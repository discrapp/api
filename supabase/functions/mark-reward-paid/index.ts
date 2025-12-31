import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';

/**
 * Mark Reward Paid Function
 *
 * Allows the finder to confirm they've received the reward payment.
 * This hides the Venmo button for the owner and tracks reward completion.
 *
 * POST /mark-reward-paid
 * Body: { recovery_event_id: string }
 *
 * Validations:
 * - User must be authenticated
 * - User must be the finder (the one who receives the reward)
 * - Recovery must be in 'recovered' status
 * - Disc must have a reward amount set
 */

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { recovery_event_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { recovery_event_id } = body;

  if (!recovery_event_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: recovery_event_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with user's auth for RLS-protected operations
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

  // Service role client only for operations that need to bypass RLS (not used in this function currently)
  const _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get recovery event with disc info (using user's JWT for RLS)
  const { data: recovery, error: recoveryError } = await supabase
    .from('recovery_events')
    .select(
      `
      id,
      finder_id,
      status,
      reward_paid_at,
      disc:discs!recovery_events_disc_id_fk(
        id,
        reward_amount
      )
    `
    )
    .eq('id', recovery_event_id)
    .single();

  if (recoveryError || !recovery) {
    return new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if user is the finder
  if (recovery.finder_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the finder can mark the reward as received' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if recovery is in 'recovered' status
  if (recovery.status !== 'recovered') {
    return new Response(JSON.stringify({ error: 'Reward can only be marked as paid after disc is recovered' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if already marked as paid
  if (recovery.reward_paid_at) {
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Reward was already marked as received',
        reward_paid_at: recovery.reward_paid_at,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Check if disc has a reward
  // Handle both array and object responses for disc
  const discData = recovery.disc as
    | { id: string; reward_amount: number | null }
    | { id: string; reward_amount: number | null }[]
    | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;
  if (!disc?.reward_amount || disc.reward_amount <= 0) {
    return new Response(JSON.stringify({ error: 'This disc does not have a reward set' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mark reward as paid (using user's JWT for RLS)
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('recovery_events')
    .update({
      reward_paid_at: now,
      updated_at: now,
    })
    .eq('id', recovery_event_id);

  if (updateError) {
    console.error('Failed to mark reward as paid:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to mark reward as received', details: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Reward marked as received',
      reward_paid_at: now,
      reward_amount: disc.reward_amount,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
