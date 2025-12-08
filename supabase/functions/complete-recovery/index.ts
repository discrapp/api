import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';

/**
 * Complete Recovery Function
 *
 * Authenticated endpoint to mark a disc recovery as complete.
 * Can be called by either the owner or finder after a meetup.
 *
 * POST /complete-recovery
 * Body: {
 *   recovery_event_id: string
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be owner or finder of the recovery event
 * - Recovery event must be in 'meetup_confirmed' status
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

  // Handle both array and object responses for disc
  const discData = recoveryEvent.disc as
    | { owner_id: string; name: string }
    | { owner_id: string; name: string }[]
    | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;
  const discOwner = disc?.owner_id;
  const discName = disc?.name || 'the disc';

  // Verify user is a participant (owner or finder)
  const isOwner = discOwner === user.id;
  const isFinder = recoveryEvent.finder_id === user.id;

  if (!isOwner && !isFinder) {
    return new Response(JSON.stringify({ error: 'You are not a participant in this recovery' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if recovery is in the correct status
  if (recoveryEvent.status !== 'meetup_confirmed') {
    return new Response(
      JSON.stringify({
        error: 'Recovery can only be completed after a meetup is confirmed',
        current_status: recoveryEvent.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Update recovery event status to 'recovered'
  const { data: updatedRecovery, error: updateError } = await supabaseAdmin
    .from('recovery_events')
    .update({
      status: 'recovered',
      recovered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', recovery_event_id)
    .select()
    .single();

  if (updateError) {
    console.error('Failed to update recovery event:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to complete recovery', details: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get the completer's display name
  const completerName = await fetchDisplayName(supabaseAdmin, user.id, 'Someone');

  // Notify the other party that the recovery is complete
  const otherPartyId = isOwner ? recoveryEvent.finder_id : discOwner;

  const notificationTitle = 'Disc recovered!';
  const notificationBodyText = `${discName} has been marked as recovered by ${completerName}`;
  const notificationData = {
    recovery_event_id,
    disc_id: recoveryEvent.disc_id,
  };

  if (otherPartyId) {
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: otherPartyId,
        type: 'disc_recovered',
        title: notificationTitle,
        body: notificationBodyText,
        data: notificationData,
      });
    } catch (notificationError) {
      console.error('Failed to create notification:', notificationError);
      // Don't fail the request, the recovery was completed successfully
    }

    // Send push notification
    await sendPushNotification({
      userId: otherPartyId,
      title: notificationTitle,
      body: notificationBodyText,
      data: notificationData,
      supabaseAdmin,
    });
  }

  // Return the updated recovery event
  return new Response(
    JSON.stringify({
      success: true,
      recovery_event: {
        id: updatedRecovery.id,
        disc_id: updatedRecovery.disc_id,
        status: updatedRecovery.status,
        recovered_at: updatedRecovery.recovered_at,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
