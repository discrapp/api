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

interface SendPushNotificationParams {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any;
}

/**
 * Send a push notification to a user via Expo Push API.
 * Automatically looks up the user's push token from their profile.
 *
 * @returns true if notification was sent successfully, false otherwise
 */
export async function sendPushNotification({
  userId,
  title,
  body,
  data,
  supabaseAdmin,
}: SendPushNotificationParams): Promise<boolean> {
  try {
    // Get user's push token
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.push_token) {
      console.log(`No push token for user ${userId}, skipping push notification`);
      return false;
    }

    // Build the push message
    const message: PushMessage = {
      to: profile.push_token as string,
      title,
      body,
      sound: 'default',
      data: data || {},
    };

    // Send to Expo Push API
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
      return false;
    }

    // Check for ticket errors
    if (result.data?.status === 'error') {
      console.error('Push notification error:', result.data);

      // If the token is invalid, clear it from the profile
      if (result.data.details?.error === 'DeviceNotRegistered') {
        await supabaseAdmin.from('profiles').update({ push_token: null }).eq('id', userId);
      }

      return false;
    }

    console.log(`Push notification sent to user ${userId}`);
    return true;
  } catch (error) {
    console.error('Failed to send push notification:', error);
    return false;
  }
}
