import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser } from '../_shared/sentry.ts';

/**
 * Create Drop-off Function
 *
 * Authenticated endpoint for finders to create a drop-off location for disc recovery.
 * The finder leaves the disc somewhere and provides photo/GPS/notes for the owner.
 *
 * POST /create-drop-off
 * Body: {
 *   recovery_event_id: string,
 *   photo_url: string,
 *   latitude: number,
 *   longitude: number,
 *   location_notes?: string
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be the finder of the recovery event
 * - Recovery event must be in 'found' status
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

  const { recovery_event_id, photo_url, latitude, longitude, location_notes } = body;

  // Validate required fields
  if (!recovery_event_id || !photo_url || latitude === undefined || longitude === undefined) {
    return new Response(
      JSON.stringify({
        error: 'Missing required fields: recovery_event_id, photo_url, latitude, longitude',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
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

  // Get the recovery event with disc info (using user's JWT for RLS)
  const { data: recoveryEvent, error: recoveryError } = await supabase
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

  // Check if user is the finder
  if (recoveryEvent.finder_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the finder can create a drop-off' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if recovery is in 'found' status
  if (recoveryEvent.status !== 'found') {
    return new Response(JSON.stringify({ error: 'Can only create drop-off for a recovery in found status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create the drop-off record (using user's JWT for RLS)
  const { data: dropOff, error: createError } = await supabase
    .from('drop_offs')
    .insert({
      recovery_event_id,
      photo_url,
      latitude,
      longitude,
      location_notes: location_notes || null,
    })
    .select()
    .single();

  if (createError) {
    console.error('Failed to create drop-off:', createError);
    return new Response(JSON.stringify({ error: 'Failed to create drop-off', details: createError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update recovery event status to 'dropped_off' (using user's JWT for RLS)
  const { error: updateError } = await supabase
    .from('recovery_events')
    .update({ status: 'dropped_off', updated_at: new Date().toISOString() })
    .eq('id', recovery_event_id);

  if (updateError) {
    console.error('Failed to update recovery event status:', updateError);
    // Don't fail the request, the drop-off was created successfully
  }

  // Get finder's display name and disc info for notification
  const finderName = await fetchDisplayName(supabaseAdmin, user.id, 'Someone');

  // Handle both array and object responses for disc relation
  type DiscInfo = { owner_id: string; name: string };
  const discData = recoveryEvent.disc as DiscInfo | DiscInfo[] | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;
  const discOwner = disc?.owner_id;
  const discName = disc?.name || 'your disc';

  const notificationTitle = 'Disc dropped off for pickup';
  const notificationBodyText = `${finderName} left ${discName} for you to pick up`;
  const notificationData = {
    recovery_event_id,
    drop_off_id: dropOff.id,
    disc_id: recoveryEvent.disc_id,
  };

  // Create notification for the owner
  if (discOwner) {
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: discOwner,
        type: 'disc_dropped_off',
        title: notificationTitle,
        body: notificationBodyText,
        data: notificationData,
      });
    } catch (notificationError) {
      console.error('Failed to create notification:', notificationError);
      // Don't fail the request, the drop-off was created successfully
    }

    // Send push notification
    await sendPushNotification({
      userId: discOwner,
      title: notificationTitle,
      body: notificationBodyText,
      data: notificationData,
      supabaseAdmin,
    });
  }

  // Return the created drop-off
  return new Response(
    JSON.stringify({
      success: true,
      drop_off: {
        id: dropOff.id,
        recovery_event_id: dropOff.recovery_event_id,
        photo_url: dropOff.photo_url,
        latitude: dropOff.latitude,
        longitude: dropOff.longitude,
        location_notes: dropOff.location_notes,
        dropped_off_at: dropOff.dropped_off_at,
        created_at: dropOff.created_at,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
