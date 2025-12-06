import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  // Check if proposal is already accepted or rejected
  if (proposal.status !== 'proposed') {
    return new Response(JSON.stringify({ error: 'This proposal has already been accepted or rejected' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get disc owner from the nested relationship
  // Supabase returns nested FK relationships as arrays
  const recoveryEventData = proposal.recovery_event as unknown as
    | {
        id: string;
        disc_id: string;
        finder_id: string;
        status: string;
        disc: { owner_id: string }[] | null;
      }[]
    | null;

  const recoveryEvent = Array.isArray(recoveryEventData) ? recoveryEventData[0] : recoveryEventData;

  if (!recoveryEvent) {
    return new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const discOwner = recoveryEvent.disc?.[0]?.owner_id;

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
      updated_at: new Date().toISOString(),
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

  // Update recovery event status to 'meetup_scheduled'
  const { error: eventUpdateError } = await supabaseAdmin
    .from('recovery_events')
    .update({
      status: 'meetup_scheduled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', proposal.recovery_event_id);

  if (eventUpdateError) {
    console.error('Failed to update recovery event status:', eventUpdateError);
    // Don't fail the request, the proposal was accepted successfully
  }

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
        updated_at: updatedProposal.updated_at,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
