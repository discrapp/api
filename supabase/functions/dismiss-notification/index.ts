import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser } from '../_shared/sentry.ts';

/**
 * Dismiss Notification Function
 *
 * Authenticated endpoint for dismissing (hiding) notifications.
 * Dismissed notifications are not deleted, just hidden from the user.
 *
 * POST /dismiss-notification
 * Body: {
 *   notification_id: string   // ID of notification to dismiss (optional if dismiss_all is true)
 *   dismiss_all: boolean      // If true, dismisses all notifications for the user
 * }
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

  const { notification_id, dismiss_all } = body;

  // Validate either notification_id or dismiss_all is provided
  if (!notification_id && !dismiss_all) {
    return new Response(JSON.stringify({ error: 'notification_id or dismiss_all is required' }), {
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

  // Set Sentry user context
  setUser(user.id);

  // Handle dismiss_all case
  if (dismiss_all) {
    const { data: notifications, error: updateError } = await supabase
      .from('notifications')
      .update({ dismissed: true, read: true })
      .eq('user_id', user.id)
      .eq('dismissed', false) // Only dismiss non-dismissed notifications
      .select('id');

    if (updateError) {
      console.error('Failed to dismiss all notifications:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to dismiss notifications', details: updateError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        dismissed_count: notifications?.length || 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Dismiss single notification (mark it as read and dismissed)
  // RLS ensures user can only update their own notifications
  const { data: notification, error: updateError } = await supabase
    .from('notifications')
    .update({ dismissed: true, read: true })
    .eq('id', notification_id)
    .eq('user_id', user.id) // Explicit check for safety
    .select()
    .single();

  if (updateError) {
    // Check if it's a "not found" error
    if (updateError.code === 'PGRST116') {
      return new Response(JSON.stringify({ error: 'Notification not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('Failed to dismiss notification:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to dismiss notification', details: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      notification: {
        id: notification.id,
        dismissed: notification.dismissed,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
