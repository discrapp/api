import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';
import { claimDiscTransaction } from '../_shared/transactions.ts';

/**
 * Claim Disc Function
 *
 * Allows a user to claim an ownerless disc (one that was abandoned).
 * The disc is transferred to the claiming user's collection.
 *
 * POST /claim-disc
 * Body: {
 *   disc_id: string
 * }
 *
 * Actions:
 * - Verifies disc has no owner (owner_id is null)
 * - Sets disc owner_id to the claiming user
 * - Closes any abandoned recovery events for this disc
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

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { disc_id } = body;

  if (!disc_id) {
    return new Response(JSON.stringify({ error: 'disc_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with user's auth for RLS-protected operations
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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

  // Service role client for transaction operations
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get the disc (using user's JWT for RLS)
  const { data: disc, error: discError } = await supabase
    .from('discs')
    .select('id, owner_id, name, manufacturer, mold, plastic, color')
    .eq('id', disc_id)
    .single();

  if (discError || !disc) {
    return new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify disc has no owner
  if (disc.owner_id !== null) {
    return new Response(JSON.stringify({ error: 'This disc already has an owner and cannot be claimed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use transaction to atomically set disc owner AND close abandoned recoveries
  // This ensures both operations succeed or both fail together
  const transactionResult = await claimDiscTransaction(supabaseAdmin, {
    discId: disc_id,
    userId: user.id,
  });

  if (!transactionResult.success) {
    console.error('Failed to claim disc:', transactionResult.error);
    captureException(new Error(transactionResult.error), {
      operation: 'claim-disc',
      discId: disc_id,
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Failed to claim disc', details: transactionResult.error }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Disc claimed successfully! It has been added to your collection.',
      disc: {
        id: disc.id,
        name: disc.name,
        manufacturer: disc.manufacturer,
        mold: disc.mold,
        plastic: disc.plastic,
        color: disc.color,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
