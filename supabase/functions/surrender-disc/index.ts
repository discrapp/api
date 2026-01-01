import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser } from '../_shared/sentry.ts';

/**
 * Surrender Disc Function
 *
 * Authenticated endpoint for disc owners to surrender ownership to the finder.
 * This transfers the disc (and its QR code) to the finder permanently.
 *
 * POST /surrender-disc
 * Body: {
 *   recovery_event_id: string
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be the disc owner (not finder)
 * - Recovery must be in active state (found, meetup_proposed, or meetup_confirmed)
 */

const handler = async (req: Request): Promise<Response> => {
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

  // Create Supabase client with user's auth for RLS-protected operations
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

  // Set Sentry user context
  setUser(user.id);

  // Service role client only for operations that need to bypass RLS (e.g., notifications to other users)
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get the recovery event with disc and QR code info (using user's JWT for RLS)
  const { data: recoveryEvent, error: recoveryError } = await supabase
    .from('recovery_events')
    .select(
      `
      id,
      disc_id,
      finder_id,
      status,
      disc:discs!recovery_events_disc_id_fk(id, owner_id, name, qr_code_id)
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
    | { id: string; owner_id: string; name: string; qr_code_id: string | null }
    | { id: string; owner_id: string; name: string; qr_code_id: string | null }[]
    | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;

  if (!disc) {
    return new Response(JSON.stringify({ error: 'Disc not found for this recovery event' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const discOwner = disc.owner_id;
  const discName = disc.name || 'the disc';
  const discId = disc.id;
  const qrCodeId = disc.qr_code_id;

  // Verify user is the disc owner (only owner can surrender)
  if (discOwner !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the disc owner can surrender the disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if recovery is in a valid state for surrender
  const validStatuses = ['found', 'meetup_proposed', 'meetup_confirmed'];
  if (!validStatuses.includes(recoveryEvent.status)) {
    return new Response(
      JSON.stringify({
        error: 'Disc can only be surrendered during an active recovery',
        current_status: recoveryEvent.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const finderId = recoveryEvent.finder_id;
  const now = new Date().toISOString();

  // Update disc ownership to the finder (using user's JWT for RLS)
  const { error: discUpdateError } = await supabase
    .from('discs')
    .update({
      owner_id: finderId,
      updated_at: now,
    })
    .eq('id', discId);

  if (discUpdateError) {
    console.error('Failed to update disc ownership:', discUpdateError);
    return new Response(
      JSON.stringify({ error: 'Failed to transfer disc ownership', details: discUpdateError.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Update QR code assignment if disc has a QR code (using user's JWT for RLS)
  // Ensure status remains 'active' since the QR is still linked to the disc
  if (qrCodeId) {
    const { error: qrUpdateError } = await supabase
      .from('qr_codes')
      .update({
        assigned_to: finderId,
        status: 'active', // Ensure status stays active when transferring ownership
        updated_at: now,
      })
      .eq('id', qrCodeId);

    if (qrUpdateError) {
      console.error('Failed to update QR code assignment:', qrUpdateError);
      // Don't fail the request - disc ownership was transferred successfully
    }
  }

  // Update recovery event status to surrendered (using user's JWT for RLS)
  const { data: updatedRecovery, error: recoveryUpdateError } = await supabase
    .from('recovery_events')
    .update({
      status: 'surrendered',
      surrendered_at: now,
      original_owner_id: user.id,
      updated_at: now,
    })
    .eq('id', recovery_event_id)
    .select()
    .single();

  if (recoveryUpdateError) {
    console.error('Failed to update recovery event:', recoveryUpdateError);
    return new Response(
      JSON.stringify({ error: 'Failed to update recovery status', details: recoveryUpdateError.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Get the owner's display name for notification
  const ownerName = await fetchDisplayName(supabaseAdmin, user.id, 'The owner');

  // Create notification for finder
  const notificationTitle = 'Disc surrendered to you!';
  const notificationBodyText = `${ownerName} has surrendered ${discName} to you. It's now in your collection!`;
  const notificationData = {
    recovery_event_id,
    disc_id: discId,
  };

  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: finderId,
      type: 'disc_surrendered',
      title: notificationTitle,
      body: notificationBodyText,
      data: notificationData,
    });
  } catch (notificationError) {
    console.error('Failed to create notification:', notificationError);
    // Don't fail the request - surrender was successful
  }

  // Send push notification to finder
  await sendPushNotification({
    userId: finderId,
    title: notificationTitle,
    body: notificationBodyText,
    data: notificationData,
    supabaseAdmin,
  });

  return new Response(
    JSON.stringify({
      success: true,
      recovery_event: {
        id: updatedRecovery.id,
        status: updatedRecovery.status,
        surrendered_at: updatedRecovery.surrendered_at,
      },
      disc: {
        id: discId,
        new_owner_id: finderId,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
