import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/push-notifications.ts';
import { fetchDisplayName } from '../_shared/display-name.ts';
import { withSentry } from '../_shared/with-sentry.ts';
import { withRateLimit, RateLimitPresets } from '../_shared/with-rate-limit.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Report Found Disc by Phone Function
 *
 * Authenticated endpoint for finders to report they found a disc via phone lookup.
 * Creates a recovery event and notifies the owner.
 *
 * POST /report-found-disc-by-phone
 * Body: {
 *   owner_id: string,           // Required - from phone lookup
 *   disc_id?: string,           // Optional - if finder matched a specific disc
 *   message?: string,           // Optional - finder's message
 *   front_photo_path?: string,  // Optional - storage path of front photo
 *   back_photo_path?: string    // Optional - storage path of back photo
 * }
 *
 * Validations:
 * - Owner must exist
 * - Finder cannot report their own disc
 * - If disc_id provided, disc must exist and belong to owner
 * - No active recovery for this disc (if disc_id provided)
 */

interface RequestBody {
  owner_id: string;
  disc_id?: string;
  message?: string;
  front_photo_path?: string;
  back_photo_path?: string;
}

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
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate owner_id
  if (!body.owner_id || typeof body.owner_id !== 'string') {
    return new Response(JSON.stringify({ error: 'owner_id is required' }), {
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

  const ownerId = body.owner_id;
  const finderId = user.id;

  // Check if finder is trying to report their own disc
  if (ownerId === finderId) {
    return new Response(JSON.stringify({ error: 'You cannot report your own disc as found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Service role client for operations that need to bypass RLS
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Verify owner exists
  const { data: ownerProfile, error: ownerError } = await supabaseAdmin
    .from('profiles')
    .select('id, username, full_name, display_preference')
    .eq('id', ownerId)
    .single();

  if (ownerError || !ownerProfile) {
    return new Response(JSON.stringify({ error: 'Owner not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate disc_id if provided
  let discName: string | null = null;
  if (body.disc_id) {
    const { data: disc, error: discError } = await supabaseAdmin
      .from('discs')
      .select('id, owner_id, name')
      .eq('id', body.disc_id)
      .single();

    if (discError || !disc) {
      return new Response(JSON.stringify({ error: 'Disc not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (disc.owner_id !== ownerId) {
      return new Response(JSON.stringify({ error: 'Disc does not belong to this owner' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for existing active recovery
    const { data: activeRecovery } = await supabaseAdmin
      .from('recovery_events')
      .select('id, status')
      .eq('disc_id', body.disc_id)
      .in('status', ['found', 'meetup_proposed', 'meetup_confirmed'])
      .limit(1)
      .maybeSingle();

    if (activeRecovery) {
      return new Response(
        JSON.stringify({
          error: 'This disc already has an active recovery in progress',
          recovery_status: activeRecovery.status,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    discName = disc.name;
  }

  try {
    // Create the recovery event
    const { data: recoveryEvent, error: createError } = await supabaseAdmin
      .from('recovery_events')
      .insert({
        disc_id: body.disc_id || null,
        finder_id: finderId,
        owner_id: ownerId,
        status: 'found',
        finder_message: body.message || null,
        front_photo_path: body.front_photo_path || null,
        back_photo_path: body.back_photo_path || null,
        found_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      console.error('Failed to create recovery event:', createError);
      captureException(createError, {
        operation: 'create-recovery-event-by-phone',
        ownerId,
        finderId,
      });
      return new Response(JSON.stringify({ error: 'Failed to create recovery event', details: createError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get finder's display name for notification
    const finderName = await fetchDisplayName(supabaseAdmin, finderId, 'Someone');

    const notificationTitle = 'Someone found a disc with your phone number!';
    const notificationBody = discName
      ? `${finderName} found your ${discName}`
      : `${finderName} found a disc with your number on it`;
    const notificationData = {
      recovery_event_id: recoveryEvent.id,
      disc_id: body.disc_id || null,
      finder_id: finderId,
    };

    // Create in-app notification for disc owner
    try {
      await supabaseAdmin.from('notifications').insert({
        user_id: ownerId,
        type: 'disc_found_by_phone',
        title: notificationTitle,
        body: notificationBody,
        data: notificationData,
      });
    } catch (notificationError) {
      console.error('Failed to create notification:', notificationError);
      captureException(notificationError, {
        operation: 'create-notification',
        recoveryEventId: recoveryEvent.id,
      });
      // Don't fail the request, the recovery was created successfully
    }

    // Send push notification
    await sendPushNotification({
      userId: ownerId,
      title: notificationTitle,
      body: notificationBody,
      data: notificationData,
      supabaseAdmin,
    });

    // Return the created recovery event
    return new Response(
      JSON.stringify({
        success: true,
        recovery_event: {
          id: recoveryEvent.id,
          disc_id: recoveryEvent.disc_id,
          disc_name: discName,
          owner_id: recoveryEvent.owner_id,
          status: recoveryEvent.status,
          finder_message: recoveryEvent.finder_message,
          front_photo_path: recoveryEvent.front_photo_path,
          back_photo_path: recoveryEvent.back_photo_path,
          found_at: recoveryEvent.found_at,
          created_at: recoveryEvent.created_at,
        },
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Report found disc error:', error);
    captureException(error, {
      operation: 'report-found-disc-by-phone',
      ownerId,
      finderId,
    });
    return new Response(JSON.stringify({ error: 'Failed to report found disc' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(withRateLimit(handler, RateLimitPresets.auth)));
