import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';

/**
 * Abandon Disc Function
 *
 * Allows an owner to abandon a disc that was dropped off for pickup.
 * The disc becomes ownerless and can be claimed by anyone who finds it.
 *
 * POST /abandon-disc
 * Body: {
 *   recovery_event_id: string
 * }
 *
 * Actions:
 * - Sets recovery status to 'abandoned'
 * - Sets disc owner_id to null (making it claimable)
 * - Notifies the finder that the owner abandoned the disc
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

  const { recovery_event_id } = body;

  if (!recovery_event_id) {
    return new Response(JSON.stringify({ error: 'recovery_event_id is required' }), {
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

  // Get the recovery event with disc info
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .select(
      `
      id,
      disc_id,
      finder_id,
      status,
      disc:discs!recovery_events_disc_id_fk(id, owner_id, name)
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

  // Cast disc to proper type
  type DiscInfo = { id: string; owner_id: string; name: string };
  const discData = recovery.disc as DiscInfo | DiscInfo[] | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;

  if (!disc) {
    return new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify user is the owner
  if (disc.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the disc owner can abandon it' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify recovery is in dropped_off status
  if (recovery.status !== 'dropped_off') {
    return new Response(JSON.stringify({ error: 'Can only abandon a disc that has been dropped off' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update recovery status to abandoned
  const { error: updateRecoveryError } = await supabaseAdmin
    .from('recovery_events')
    .update({
      status: 'abandoned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', recovery_event_id);

  if (updateRecoveryError) {
    console.error('Failed to update recovery status:', updateRecoveryError);
    return new Response(JSON.stringify({ error: 'Failed to abandon disc', details: updateRecoveryError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Set disc owner_id to null (making it claimable)
  const { error: updateDiscError } = await supabaseAdmin
    .from('discs')
    .update({
      owner_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', disc.id);

  if (updateDiscError) {
    console.error('Failed to update disc owner:', updateDiscError);
    // Don't fail the request - the recovery was updated successfully
  }

  // Notify the finder
  const discName = disc.name || 'A disc';
  const notificationTitle = 'Disc abandoned';
  const notificationBody = `The owner has abandoned ${discName}. It's now available for anyone to claim.`;
  const notificationData = {
    recovery_event_id,
    disc_id: disc.id,
  };

  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: recovery.finder_id,
      type: 'disc_abandoned',
      title: notificationTitle,
      body: notificationBody,
      data: notificationData,
    });
  } catch (notificationError) {
    console.error('Failed to create notification:', notificationError);
  }

  // Send push notification to finder
  await sendPushNotification({
    userId: recovery.finder_id,
    title: notificationTitle,
    body: notificationBody,
    data: notificationData,
    supabaseAdmin,
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Disc has been abandoned and is now available for anyone to claim',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
