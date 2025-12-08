import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Mark Notification Read Function
 *
 * Authenticated endpoint for marking notifications as read.
 *
 * POST /mark-notification-read
 * Body: {
 *   notification_id?: string   // Mark single notification as read
 *   mark_all?: boolean         // Mark all notifications as read
 * }
 *
 * Either notification_id or mark_all must be provided.
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

  const { notification_id, mark_all } = body;

  // Validate that at least one option is provided
  if (!notification_id && !mark_all) {
    return new Response(JSON.stringify({ error: 'Either notification_id or mark_all must be provided' }), {
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

  if (mark_all) {
    // Mark all unread notifications as read for this user
    const { error: updateError, data: updated } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
      .select('id');

    if (updateError) {
      console.error('Failed to mark all notifications as read:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to mark notifications as read', details: updateError.message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        marked_count: updated?.length || 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Mark single notification as read
  // RLS ensures user can only update their own notifications
  const { data: notification, error: updateError } = await supabase
    .from('notifications')
    .update({ read: true })
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
    console.error('Failed to mark notification as read:', updateError);
    return new Response(
      JSON.stringify({ error: 'Failed to mark notification as read', details: updateError.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      notification: {
        id: notification.id,
        read: notification.read,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
