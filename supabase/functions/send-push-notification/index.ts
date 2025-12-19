import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { captureException } from '../_shared/sentry.ts';

/**
 * Send Push Notification Function
 *
 * Internal function for sending push notifications via Expo Push API.
 * Called by other edge functions after creating in-app notifications.
 *
 * POST /send-push-notification
 * Body: {
 *   user_id: string,
 *   title: string,
 *   body: string,
 *   data?: object
 * }
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
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

  const { user_id, title, body: notificationBody, data } = body;

  // Validate required fields
  if (!user_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: user_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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

  // Use service role for database operations
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get user's push token
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('push_token')
    .eq('id', user_id)
    .single();

  if (profileError) {
    console.error('Failed to get user profile:', profileError);
    captureException(profileError, { operation: 'get-push-token', userId: user_id });
    return new Response(JSON.stringify({ error: 'Failed to get user profile', details: profileError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If user doesn't have a push token, skip sending
  if (!profile?.push_token) {
    return new Response(
      JSON.stringify({
        success: true,
        skipped: true,
        reason: 'User has no push token registered',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Build the push message
  const message: PushMessage = {
    to: profile.push_token,
    title,
    body: notificationBody,
    sound: 'default',
    data: data || {},
  };

  // Send to Expo Push API
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Expo push API error:', result);
      captureException(new Error('Expo push API error'), { operation: 'expo-push-api', userId: user_id, result });
      return new Response(
        JSON.stringify({
          error: 'Failed to send push notification',
          details: result,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check for ticket errors
    if (result.data?.status === 'error') {
      console.error('Push notification error:', result.data);

      // If the token is invalid, clear it from the profile
      if (result.data.details?.error === 'DeviceNotRegistered') {
        await supabaseAdmin.from('profiles').update({ push_token: null }).eq('id', user_id);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: result.data.message || 'Push notification failed',
          details: result.data.details,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        ticket: result.data,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Failed to send push notification:', error);
    captureException(error, { operation: 'send-push-notification', userId: user_id });
    return new Response(
      JSON.stringify({
        error: 'Failed to send push notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

Deno.serve(withSentry(handler));
