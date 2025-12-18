import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';

/**
 * Relinquish Disc Function
 *
 * Authenticated endpoint for disc owners to abandon their disc after a drop-off,
 * transferring ownership to the finder.
 *
 * POST /relinquish-disc
 * Body: {
 *   recovery_event_id: string
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be the owner of the disc
 * - Recovery event must be in 'dropped_off' status
 *
 * Actions:
 * - Updates recovery status to 'abandoned'
 * - Transfers disc ownership to finder
 * - Notifies finder they now own the disc
 */

Deno.serve(async (req) => {
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

  // Parse request body
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

  // Validate required fields
  if (!recovery_event_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: recovery_event_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with user's auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
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

  // Use service role for database operations
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get the recovery event with disc info
  const { data: recoveryEvent, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .select(
      `
      id,
      disc_id,
      finder_id,
      status,
      disc:discs!recovery_events_disc_id_fk(owner_id, name)
    `
    )
    .eq('id', recovery_event_id)
    .single();

  if (recoveryError || !recoveryEvent) {
    return new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Handle both array and object responses for disc relation
  type DiscInfo = { owner_id: string; name: string };
  const discData = recoveryEvent.disc as DiscInfo | DiscInfo[] | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;
  const discOwner = disc?.owner_id;
  const discName = disc?.name || 'a disc';

  // Check if user is the owner
  if (discOwner !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the disc owner can relinquish' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if recovery is in 'dropped_off' status
  if (recoveryEvent.status !== 'dropped_off') {
    return new Response(JSON.stringify({ error: 'Can only relinquish a disc in drop-off status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update recovery event status to 'abandoned'
  const { error: updateRecoveryError } = await supabaseAdmin
    .from('recovery_events')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('id', recovery_event_id);

  if (updateRecoveryError) {
    console.error('Failed to update recovery event:', updateRecoveryError);
    return new Response(
      JSON.stringify({ error: 'Failed to update recovery event', details: updateRecoveryError.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Transfer disc ownership to finder
  const { error: transferError } = await supabaseAdmin
    .from('discs')
    .update({ owner_id: recoveryEvent.finder_id, updated_at: new Date().toISOString() })
    .eq('id', recoveryEvent.disc_id);

  if (transferError) {
    console.error('Failed to transfer disc ownership:', transferError);
    // Don't fail - the recovery was already updated
  }

  // Get original owner's display name for notification
  const ownerName = await fetchDisplayName(supabaseAdmin, user.id, 'The original owner');

  const notificationTitle = 'Disc is now yours!';
  const notificationBodyText = `${ownerName} has relinquished ${discName} to you. It's now in your collection!`;
  const notificationData = {
    recovery_event_id,
    disc_id: recoveryEvent.disc_id,
  };

  // Create notification for the finder
  if (recoveryEvent.finder_id) {
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: recoveryEvent.finder_id,
        type: 'disc_relinquished',
        title: notificationTitle,
        body: notificationBodyText,
        data: notificationData,
      });
    } catch (notificationError) {
      console.error('Failed to create notification:', notificationError);
      // Don't fail the request
    }

    // Send push notification to finder
    await sendPushNotification({
      userId: recoveryEvent.finder_id,
      title: notificationTitle,
      body: notificationBodyText,
      data: notificationData,
      supabaseAdmin,
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Disc relinquished to finder',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
