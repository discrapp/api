import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
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

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get the disc
  const { data: disc, error: discError } = await supabaseAdmin
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

  // Set disc owner_id to the claiming user
  const { error: updateError } = await supabaseAdmin
    .from('discs')
    .update({
      owner_id: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', disc_id);

  if (updateError) {
    console.error('Failed to claim disc:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to claim disc', details: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Close any abandoned recovery events for this disc
  const { error: closeRecoveryError } = await supabaseAdmin
    .from('recovery_events')
    .update({
      status: 'recovered',
      recovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('disc_id', disc_id)
    .eq('status', 'abandoned');

  if (closeRecoveryError) {
    console.error('Failed to close recovery events:', closeRecoveryError);
    // Don't fail - the disc was claimed successfully
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
});
