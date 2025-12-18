import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';

/**
 * Mark Disc Retrieved Function
 *
 * Authenticated endpoint for disc owners to confirm they picked up their disc
 * from a drop-off location.
 *
 * POST /mark-disc-retrieved
 * Body: {
 *   recovery_event_id: string
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be the owner of the disc
 * - Recovery event must be in 'dropped_off' status
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

  // Get the recovery event with disc and drop-off info
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
  const discName = disc?.name || 'your disc';

  // Check if user is the owner
  if (discOwner !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the disc owner can mark as retrieved' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if recovery is in 'dropped_off' status
  if (recoveryEvent.status !== 'dropped_off') {
    return new Response(JSON.stringify({ error: 'Can only mark as retrieved for a drop-off recovery' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update the drop-off record with retrieved_at timestamp
  const { error: dropOffError } = await supabaseAdmin
    .from('drop_offs')
    .update({ retrieved_at: new Date().toISOString() })
    .eq('recovery_event_id', recovery_event_id);

  if (dropOffError) {
    console.error('Failed to update drop-off:', dropOffError);
    return new Response(JSON.stringify({ error: 'Failed to update drop-off', details: dropOffError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update recovery event status to 'recovered'
  const { error: updateError } = await supabaseAdmin
    .from('recovery_events')
    .update({ status: 'recovered', updated_at: new Date().toISOString() })
    .eq('id', recovery_event_id);

  if (updateError) {
    console.error('Failed to update recovery event status:', updateError);
    // Don't fail the request, the drop-off was updated successfully
  }

  // Get owner's display name for notification
  const ownerName = await fetchDisplayName(supabaseAdmin, user.id, 'The owner');

  const notificationTitle = 'Disc retrieved!';
  const notificationBodyText = `${ownerName} picked up ${discName}. Thank you for helping!`;
  const notificationData = {
    recovery_event_id,
    disc_id: recoveryEvent.disc_id,
  };

  // Create notification for the finder
  if (recoveryEvent.finder_id) {
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: recoveryEvent.finder_id,
        type: 'disc_retrieved',
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
      message: 'Disc marked as retrieved',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
