import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchDisplayName } from '../_shared/display-name.ts';
import { withSentry } from '../_shared/with-sentry.ts';
import { withRateLimit, RateLimitPresets } from '../_shared/with-rate-limit.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Send Disc Found SMS Function
 *
 * Sends an SMS to a phone number inviting them to download Discr
 * when someone finds a disc with their number but they're not on the platform.
 *
 * POST /send-disc-found-sms
 * Body: { phone_number: string }
 *
 * Rate limited to prevent spam:
 * - Max 1 SMS per phone number per 24 hours
 * - Uses expensive rate limit preset (2/min)
 */

interface RequestBody {
  phone_number: string;
}

/**
 * Normalize phone number to E.164 format (+1XXXXXXXXXX for US)
 */
function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, '');

  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    }
  }

  return cleaned;
}

/**
 * Validate phone number format
 */
function isValidPhoneNumber(phone: string): boolean {
  const normalized = normalizePhoneNumber(phone);
  return /^\+\d{10,15}$/.test(normalized);
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

  // Create Supabase client for auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey, {
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

  // Validate phone number
  if (!body.phone_number || typeof body.phone_number !== 'string') {
    return new Response(JSON.stringify({ error: 'phone_number is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const normalizedPhone = normalizePhoneNumber(body.phone_number);

  if (!isValidPhoneNumber(body.phone_number)) {
    return new Response(JSON.stringify({ error: 'Invalid phone number format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create service role client for admin operations
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Check for recent SMS to this number (rate limit per recipient)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentSms } = await supabaseAdmin
    .from('sms_logs')
    .select('id')
    .eq('recipient_phone', normalizedPhone)
    .gte('sent_at', twentyFourHoursAgo)
    .limit(1);

  if (recentSms && recentSms.length > 0) {
    return new Response(JSON.stringify({ error: 'An SMS was already sent to this number recently' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get Twilio credentials
  const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const twilioFromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

  if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
    console.error('Twilio credentials not configured');
    return new Response(JSON.stringify({ error: 'SMS service not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Get sender's display name
    const finderName = await fetchDisplayName(supabaseAdmin, user.id, 'Someone');

    // Compose the SMS message
    const smsMessage = `Hey! ${finderName} found a disc with your number on it. Download Discr to connect with them and get it back: https://discr.app/download`;

    // Send SMS via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const twilioAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${twilioAuth}`,
      },
      body: new URLSearchParams({
        To: normalizedPhone,
        From: twilioFromNumber,
        Body: smsMessage,
      }).toString(),
    });

    if (!twilioResponse.ok) {
      const errorText = await twilioResponse.text();
      console.error('Twilio API error:', twilioResponse.status, errorText);
      captureException(new Error(`Twilio API error: ${twilioResponse.status}`), {
        operation: 'send-disc-found-sms',
        statusCode: twilioResponse.status,
        errorText,
      });
      return new Response(JSON.stringify({ error: 'Failed to send SMS' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const twilioData = await twilioResponse.json();

    // Log the SMS for rate limiting and audit
    await supabaseAdmin.from('sms_logs').insert({
      sender_id: user.id,
      recipient_phone: normalizedPhone,
      message_type: 'disc_found_invite',
      twilio_sid: twilioData.sid,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message_id: twilioData.sid,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('SMS error:', error);
    captureException(error, {
      operation: 'send-disc-found-sms',
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Failed to send SMS' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(withRateLimit(handler, RateLimitPresets.expensive)));
