import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';

/**
 * Accept Meetup Function
 *
 * Authenticated endpoint for disc owners to accept a meetup proposal.
 *
 * POST /accept-meetup
 * Body: {
 *   proposal_id: string
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be the disc owner
 * - Proposal must exist and be in 'proposed' status
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

  const { proposal_id } = body;

  // Validate required fields
  if (!proposal_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: proposal_id' }), {
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

  // Get the meetup proposal with recovery event and disc info
  const { data: proposal, error: proposalError } = await supabaseAdmin
    .from('meetup_proposals')
    .select(
      `
      id,
      recovery_event_id,
      proposed_by,
      location_name,
      latitude,
      longitude,
      proposed_datetime,
      status,
      message,
      recovery_event:recovery_events!meetup_proposals_recovery_event_id_fk(
        id,
        disc_id,
        finder_id,
        status,
        disc:discs!recovery_events_disc_id_fk(owner_id)
      )
    `
    )
    .eq('id', proposal_id)
    .single();

  if (proposalError || !proposal) {
    return new Response(JSON.stringify({ error: 'Meetup proposal not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if proposal is already accepted or declined
  if (proposal.status !== 'pending') {
    return new Response(JSON.stringify({ error: 'This proposal has already been accepted or declined' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get disc owner from the nested relationship
  // Supabase returns nested FK relationships differently based on join type
  const recoveryEventData = proposal.recovery_event as unknown as
    | {
        id: string;
        disc_id: string;
        finder_id: string;
        status: string;
        disc: { owner_id: string } | { owner_id: string }[] | null;
      }
    | {
        id: string;
        disc_id: string;
        finder_id: string;
        status: string;
        disc: { owner_id: string } | { owner_id: string }[] | null;
      }[]
    | null;

  const recoveryEvent = Array.isArray(recoveryEventData) ? recoveryEventData[0] : recoveryEventData;

  if (!recoveryEvent) {
    console.error('Recovery event not found. Raw data:', JSON.stringify(proposal.recovery_event));
    return new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Handle both array and object responses for disc
  const discData = recoveryEvent.disc;
  const disc = Array.isArray(discData) ? discData[0] : discData;
  const discOwner = disc?.owner_id;

  console.log('Authorization check:', {
    userId: user.id,
    discOwner,
    rawDiscData: JSON.stringify(recoveryEvent.disc),
  });

  // Verify user is the disc owner
  if (discOwner !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the disc owner can accept meetup proposals' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update the proposal status to accepted
  const { data: updatedProposal, error: updateError } = await supabaseAdmin
    .from('meetup_proposals')
    .update({
      status: 'accepted',
    })
    .eq('id', proposal_id)
    .select()
    .single();

  if (updateError) {
    console.error('Failed to update proposal:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to accept proposal', details: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update recovery event status to 'meetup_confirmed'
  const { error: eventUpdateError } = await supabaseAdmin
    .from('recovery_events')
    .update({
      status: 'meetup_confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', proposal.recovery_event_id);

  if (eventUpdateError) {
    console.error('Failed to update recovery event status:', eventUpdateError);
    // Don't fail the request, the proposal was accepted successfully
  }

  // Get owner's display name and disc info for notification
  const ownerName = await fetchDisplayName(supabaseAdmin, user.id, 'The owner');

  const { data: discInfo } = await supabaseAdmin.from('discs').select('name').eq('id', recoveryEvent.disc_id).single();
  const discName = discInfo?.name || 'the disc';

  const notificationTitle = 'Meetup accepted!';
  const notificationBodyText = `${ownerName} accepted your meetup proposal for ${discName}`;
  const notificationData = {
    recovery_event_id: proposal.recovery_event_id,
    proposal_id: proposal.id,
    disc_id: recoveryEvent.disc_id,
  };

  // Notify the finder that the meetup was accepted
  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: recoveryEvent.finder_id,
      type: 'meetup_accepted',
      title: notificationTitle,
      body: notificationBodyText,
      data: notificationData,
    });
  } catch (notificationError) {
    console.error('Failed to create notification:', notificationError);
    // Don't fail the request, the proposal was accepted successfully
  }

  // Send push notification
  await sendPushNotification({
    userId: recoveryEvent.finder_id,
    title: notificationTitle,
    body: notificationBodyText,
    data: notificationData,
    supabaseAdmin,
  });

  // Return the updated proposal
  return new Response(
    JSON.stringify({
      success: true,
      proposal: {
        id: updatedProposal.id,
        recovery_event_id: updatedProposal.recovery_event_id,
        proposed_by: updatedProposal.proposed_by,
        location_name: updatedProposal.location_name,
        latitude: updatedProposal.latitude,
        longitude: updatedProposal.longitude,
        proposed_datetime: updatedProposal.proposed_datetime,
        status: updatedProposal.status,
        message: updatedProposal.message,
        created_at: updatedProposal.created_at,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
