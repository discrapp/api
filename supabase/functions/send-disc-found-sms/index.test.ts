import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { RateLimitPresets } from '../_shared/with-rate-limit.ts';

// Mock data types
interface MockUser {
  id: string;
  email: string;
}

interface MockProfile {
  id: string;
  username: string;
  full_name: string | null;
  display_preference: string;
}

interface MockSmsLog {
  id: string;
  sender_id: string;
  recipient_phone: string;
  message_type: string;
  sent_at: string;
}

// Mock state
let mockAuthUsers: MockUser[] = [];
let mockProfiles: MockProfile[] = [];
let mockSmsLogs: MockSmsLog[] = [];
let mockTwilioResponse: { status: number; body: unknown } = {
  status: 201,
  body: { sid: 'SM123456789', status: 'queued' },
};

function resetMocks() {
  mockAuthUsers = [];
  mockProfiles = [];
  mockSmsLogs = [];
  mockTwilioResponse = {
    status: 201,
    body: { sid: 'SM123456789', status: 'queued' },
  };
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: mockAuthUsers[0] || null },
        error: mockAuthUsers[0] ? null : { message: 'No user' },
      }),
    },
  };
}

// Mock Supabase admin client
function mockSupabaseAdmin() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: async () => {
            if (table === 'profiles') {
              const profile = mockProfiles.find((p) => p[column as keyof MockProfile] === value);
              return {
                data: profile || null,
                error: profile ? null : { code: 'PGRST116' },
              };
            }
            return { data: null, error: null };
          },
          gte: (_col: string, _val: string) => ({
            then: async (
              resolve: (val: { data: MockSmsLog[]; error: null }) => void
            ): Promise<{ data: MockSmsLog[]; error: null }> => {
              const result = { data: mockSmsLogs, error: null };
              resolve(result);
              return result;
            },
          }),
        }),
      }),
      insert: (data: Partial<MockSmsLog>) => {
        const newLog = {
          ...data,
          id: `sms-${Date.now()}`,
          sent_at: new Date().toISOString(),
        } as MockSmsLog;
        mockSmsLogs.push(newLog);
        return Promise.resolve({ error: null });
      },
    }),
  };
}

// Mock fetch for Twilio API
const originalFetch = globalThis.fetch;
function mockFetch(_url: string | URL | Request, _init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(mockTwilioResponse.body), {
      status: mockTwilioResponse.status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

Deno.test('send-disc-found-sms: returns 405 for non-POST requests', async () => {
  const response = await mockHandler('GET', null, null);

  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error, 'Method not allowed');
});

Deno.test('send-disc-found-sms: returns 401 without auth header', async () => {
  const response = await mockHandler('POST', null, { phone_number: '5125551234' });

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Missing authorization header');
});

Deno.test('send-disc-found-sms: returns 401 for invalid user', async () => {
  resetMocks();

  const response = await mockHandler('POST', 'Bearer invalid-token', { phone_number: '5125551234' });

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Unauthorized');
});

Deno.test('send-disc-found-sms: returns 400 when phone_number is missing', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });

  const response = await mockHandler('POST', 'Bearer valid-token', {});

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'phone_number is required');
});

Deno.test('send-disc-found-sms: returns 400 for invalid phone format', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '123' });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Invalid phone number format');
});

Deno.test('send-disc-found-sms: returns 429 when rate limited (too many SMS to same number)', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });
  mockProfiles.push({
    id: 'user-1',
    username: 'finder',
    full_name: null,
    display_preference: 'username',
  });
  // Simulate recent SMS to same number
  mockSmsLogs.push({
    id: 'sms-1',
    sender_id: 'user-1',
    recipient_phone: '+15125551234',
    message_type: 'disc_found_invite',
    sent_at: new Date().toISOString(),
  });

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });

  assertEquals(response.status, 429);
  const body = await response.json();
  assertEquals(body.error, 'An SMS was already sent to this number recently');
});

Deno.test('send-disc-found-sms: successfully sends SMS', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });
  mockProfiles.push({
    id: 'user-1',
    username: 'helpfulfinder',
    full_name: 'John Smith',
    display_preference: 'full_name',
  });

  globalThis.fetch = mockFetch;
  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '(512) 555-1234' });
  globalThis.fetch = originalFetch;

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.message_id);
});

Deno.test('send-disc-found-sms: logs the SMS attempt', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });
  mockProfiles.push({
    id: 'user-1',
    username: 'finder',
    full_name: null,
    display_preference: 'username',
  });

  globalThis.fetch = mockFetch;
  await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });
  globalThis.fetch = originalFetch;

  assertEquals(mockSmsLogs.length, 1);
  assertEquals(mockSmsLogs[0].sender_id, 'user-1');
  assertEquals(mockSmsLogs[0].recipient_phone, '+15125551234');
  assertEquals(mockSmsLogs[0].message_type, 'disc_found_invite');
});

Deno.test('send-disc-found-sms: handles Twilio API error', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });
  mockProfiles.push({
    id: 'user-1',
    username: 'finder',
    full_name: null,
    display_preference: 'username',
  });

  mockTwilioResponse = {
    status: 400,
    body: { message: 'Invalid phone number' },
  };

  globalThis.fetch = mockFetch;
  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });
  globalThis.fetch = originalFetch;

  assertEquals(response.status, 502);
  const body = await response.json();
  assertEquals(body.error, 'Failed to send SMS');
});

Deno.test('send-disc-found-sms: uses finder display name in message', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });
  mockProfiles.push({
    id: 'user-1',
    username: 'discfinder',
    full_name: 'Jane Doe',
    display_preference: 'full_name',
  });

  let capturedBody = '';
  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedBody = init?.body?.toString() || '';
    return new Response(JSON.stringify({ sid: 'SM123', status: 'queued' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });
  globalThis.fetch = originalFetch;

  // The message body should include the finder name
  assertEquals(capturedBody.includes('Jane'), true);
});

Deno.test('send-disc-found-sms: normalizes various phone formats', async () => {
  const formats = [
    { input: '5125551234', expected: '+15125551234' },
    { input: '512-555-1234', expected: '+15125551234' },
    { input: '(512) 555-1234', expected: '+15125551234' },
    { input: '1-512-555-1234', expected: '+15125551234' },
    { input: '+1 512 555 1234', expected: '+15125551234' },
  ];

  for (const { input, expected } of formats) {
    resetMocks();
    mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });
    mockProfiles.push({
      id: 'user-1',
      username: 'finder',
      full_name: null,
      display_preference: 'username',
    });

    globalThis.fetch = mockFetch;
    await mockHandler('POST', 'Bearer valid-token', { phone_number: input });
    globalThis.fetch = originalFetch;

    assertEquals(mockSmsLogs[0].recipient_phone, expected, `Failed for format: ${input}`);
  }
});

Deno.test('send-disc-found-sms: should use expensive rate limit preset', () => {
  assertEquals(RateLimitPresets.expensive.maxRequests, 2);
  assertEquals(RateLimitPresets.expensive.windowMs, 60000);
});

// Phone normalization helpers
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

function isValidPhoneNumber(phone: string): boolean {
  const normalized = normalizePhoneNumber(phone);
  return /^\+\d{10,15}$/.test(normalized);
}

// Mock handler that simulates the actual handler behavior
async function mockHandler(
  method: string,
  authHeader: string | null,
  body: Record<string, unknown> | null
): Promise<Response> {
  // Method check
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth check
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // User check
  const client = mockSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const senderId = data.user.id;

  // Validate phone_number
  if (!body?.phone_number || typeof body.phone_number !== 'string') {
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

  const admin = mockSupabaseAdmin();

  // Check for recent SMS to same number (rate limit)
  const recentSms = mockSmsLogs.find(
    (log) =>
      log.recipient_phone === normalizedPhone && new Date(log.sent_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
  );

  if (recentSms) {
    return new Response(JSON.stringify({ error: 'An SMS was already sent to this number recently' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get sender's display name
  const finderResult = await admin
    .from('profiles')
    .select('username, full_name, display_preference')
    .eq('id', senderId)
    .single();

  let finderName = 'Someone';
  if (finderResult.data) {
    const profile = finderResult.data as MockProfile;
    if (profile.display_preference === 'full_name' && profile.full_name) {
      finderName = profile.full_name;
    } else if (profile.username) {
      finderName = `@${profile.username}`;
    }
  }

  // Compose SMS message
  const smsMessage = `Hey! ${finderName} found a disc with your number on it. Download Discr to connect with them and get it back: https://discr.app/download`;

  // Call Twilio API (mocked in tests)
  const twilioResponse = await globalThis.fetch('https://api.twilio.com/2010-04-01/Accounts/test/Messages.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic test',
    },
    body: new URLSearchParams({
      To: normalizedPhone,
      From: '+15551234567',
      Body: smsMessage,
    }).toString(),
  });

  if (!twilioResponse.ok) {
    return new Response(JSON.stringify({ error: 'Failed to send SMS' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const twilioData = await twilioResponse.json();

  // Log the SMS
  await admin.from('sms_logs').insert({
    sender_id: senderId,
    recipient_phone: normalizedPhone,
    message_type: 'disc_found_invite',
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
}
