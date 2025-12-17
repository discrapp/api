import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';

/**
 * Propose Meetup Function
 *
 * Authenticated endpoint for participants (owner or finder) to propose a meetup
 * for disc recovery.
 *
 * POST /propose-meetup
 * Body: {
 *   recovery_event_id: string,
 *   location_name: string,
 *   latitude?: number,
 *   longitude?: number,
 *   proposed_datetime: string (ISO datetime),
 *   message?: string
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be owner or finder of the recovery event
 * - Recovery event must not be completed or cancelled
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

  const { recovery_event_id, location_name, latitude, longitude, proposed_datetime, message } = body;

  // Validate required fields
  if (!recovery_event_id || !location_name || !proposed_datetime) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: recovery_event_id, location_name, proposed_datetime' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
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

  // Get the recovery event with disc info to check ownership
  const { data: recoveryEvent, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .select(
      `
      id,
      disc_id,
      finder_id,
      status,
      disc:discs!recovery_events_disc_id_fk(owner_id)
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

  // Check if recovery is already completed or cancelled
  if (recoveryEvent.status === 'recovered' || recoveryEvent.status === 'cancelled') {
    return new Response(JSON.stringify({ error: 'Cannot propose meetup for a completed or cancelled recovery' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if user is a participant (owner or finder)
  // Handle both array and object responses for disc relation
  const discData = recoveryEvent.disc as { owner_id: string } | { owner_id: string }[] | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;
  const discOwner = disc?.owner_id;
  const isOwner = discOwner === user.id;
  const isFinder = recoveryEvent.finder_id === user.id;

  if (!isOwner && !isFinder) {
    return new Response(JSON.stringify({ error: 'You are not a participant in this recovery' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auto-decline any existing pending proposals (counter-proposal flow)
  // This allows either party to propose an alternative meetup
  const { data: existingProposals } = await supabaseAdmin
    .from('meetup_proposals')
    .select('id, proposed_by')
    .eq('recovery_event_id', recovery_event_id)
    .eq('status', 'pending');

  if (existingProposals && existingProposals.length > 0) {
    // Decline all pending proposals (typically just one)
    const proposalIds = existingProposals.map((p) => p.id);
    await supabaseAdmin.from('meetup_proposals').update({ status: 'declined' }).in('id', proposalIds);

    // Notify the original proposer(s) that their proposal was countered
    for (const proposal of existingProposals) {
      if (proposal.proposed_by !== user.id) {
        const { data: discInfo } = await supabaseAdmin
          .from('discs')
          .select('name')
          .eq('id', recoveryEvent.disc_id)
          .single();
        const discName = discInfo?.name || 'the disc';
        const counterProposerName = await fetchDisplayName(supabaseAdmin, user.id, 'The other party');

        try {
          await supabaseAdmin.from('notifications').insert({
            user_id: proposal.proposed_by,
            type: 'meetup_countered',
            title: 'Meetup counter-proposal',
            body: `${counterProposerName} suggested a different meetup for ${discName}`,
            data: { recovery_event_id, disc_id: recoveryEvent.disc_id },
          });

          await sendPushNotification({
            userId: proposal.proposed_by,
            title: 'Meetup counter-proposal',
            body: `${counterProposerName} suggested a different meetup for ${discName}`,
            data: { recovery_event_id, disc_id: recoveryEvent.disc_id },
            supabaseAdmin,
          });
        } catch (notificationError) {
          console.error('Failed to send counter-proposal notification:', notificationError);
        }
      }
    }
  }

  // Create the meetup proposal
  const { data: proposal, error: createError } = await supabaseAdmin
    .from('meetup_proposals')
    .insert({
      recovery_event_id,
      proposed_by: user.id,
      location_name,
      latitude: latitude || null,
      longitude: longitude || null,
      proposed_datetime,
      status: 'pending',
      message: message || null,
    })
    .select()
    .single();

  if (createError) {
    console.error('Failed to create meetup proposal:', createError);
    return new Response(JSON.stringify({ error: 'Failed to create meetup proposal', details: createError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update recovery event status to 'meetup_proposed'
  const { error: updateError } = await supabaseAdmin
    .from('recovery_events')
    .update({ status: 'meetup_proposed', updated_at: new Date().toISOString() })
    .eq('id', recovery_event_id);

  if (updateError) {
    console.error('Failed to update recovery event status:', updateError);
    // Don't fail the request, the proposal was created successfully
  }

  // Get proposer's display name and disc info for notification
  const proposerName = await fetchDisplayName(supabaseAdmin, user.id, 'Someone');

  const { data: discInfo } = await supabaseAdmin.from('discs').select('name').eq('id', recoveryEvent.disc_id).single();
  const discName = discInfo?.name || 'your disc';

  // Determine recipient: if proposer is owner, notify finder; if proposer is finder, notify owner
  const recipientId = isOwner ? recoveryEvent.finder_id : discOwner;

  const notificationTitle = 'New meetup proposal';
  const notificationBodyText = `${proposerName} proposed a meetup for ${discName}`;
  const notificationData = {
    recovery_event_id,
    proposal_id: proposal.id,
    disc_id: recoveryEvent.disc_id,
  };

  // Create notification for the other party
  if (recipientId) {
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: recipientId,
        type: 'meetup_proposed',
        title: notificationTitle,
        body: notificationBodyText,
        data: notificationData,
      });
    } catch (notificationError) {
      console.error('Failed to create notification:', notificationError);
      // Don't fail the request, the proposal was created successfully
    }

    // Send push notification
    await sendPushNotification({
      userId: recipientId,
      title: notificationTitle,
      body: notificationBodyText,
      data: notificationData,
      supabaseAdmin,
    });
  }

  // Return the created proposal
  return new Response(
    JSON.stringify({
      success: true,
      proposal: {
        id: proposal.id,
        recovery_event_id: proposal.recovery_event_id,
        proposed_by: proposal.proposed_by,
        location_name: proposal.location_name,
        latitude: proposal.latitude,
        longitude: proposal.longitude,
        proposed_datetime: proposal.proposed_datetime,
        status: proposal.status,
        message: proposal.message,
        created_at: proposal.created_at,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
