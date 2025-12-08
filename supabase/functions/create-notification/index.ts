import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Create Notification Function
 *
 * Internal function for creating notifications. Called by other edge functions.
 * Uses service role key for insertion (bypasses RLS).
 *
 * POST /create-notification
 * Body: {
 *   user_id: string,
 *   type: 'disc_found' | 'meetup_proposed' | 'meetup_accepted' | 'meetup_declined' | 'disc_recovered',
 *   title: string,
 *   body: string,
 *   data?: object
 * }
 */

type NotificationType = 'disc_found' | 'meetup_proposed' | 'meetup_accepted' | 'meetup_declined' | 'disc_recovered';

interface CreateNotificationRequest {
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const VALID_TYPES: NotificationType[] = [
  'disc_found',
  'meetup_proposed',
  'meetup_accepted',
  'meetup_declined',
  'disc_recovered',
];

Deno.serve(async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let body: CreateNotificationRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user_id, type, title, body: notificationBody, data } = body;

  // Validate required fields
  if (!user_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: user_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!type) {
    return new Response(JSON.stringify({ error: 'Missing required field: type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!VALID_TYPES.includes(type)) {
    return new Response(
      JSON.stringify({
        error: `Invalid notification type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (!title) {
    return new Response(JSON.stringify({ error: 'Missing required field: title' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!notificationBody) {
    return new Response(JSON.stringify({ error: 'Missing required field: body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use service role for database operations (bypasses RLS)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Create the notification
  const { data: notification, error: insertError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id,
      type,
      title,
      body: notificationBody,
      data: data || {},
    })
    .select()
    .single();

  if (insertError) {
    console.error('Failed to create notification:', insertError);
    return new Response(JSON.stringify({ error: 'Failed to create notification', details: insertError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      notification: {
        id: notification.id,
        user_id: notification.user_id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        read: notification.read,
        created_at: notification.created_at,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
