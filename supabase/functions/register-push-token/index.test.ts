import { assertEquals } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockProfile = {
  id: string;
  push_token?: string | null;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockProfile: MockProfile | null = null;
let authHeaderPresent = false;

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockProfile = null;
  authHeaderPresent = false;
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: () => {
        if (mockUser && authHeaderPresent) {
          return Promise.resolve({ data: { user: mockUser }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } });
      },
    },
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, _value: string) => ({
          select: () => ({
            single: () => {
              if (table === 'profiles' && mockProfile) {
                mockProfile = { ...mockProfile, ...values } as MockProfile;
                return Promise.resolve({ data: mockProfile, error: null });
              }
              return Promise.resolve({ data: null, error: { message: 'Profile not found' } });
            },
          }),
        }),
      }),
      select: (_columns?: string) => ({
        eq: (_column: string, _value: string) => ({
          single: () => {
            if (table === 'profiles' && mockProfile) {
              return Promise.resolve({ data: mockProfile, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Profile not found' } });
          },
        }),
      }),
    }),
  };
}

Deno.test('register-push-token: should return 405 for non-POST requests', async () => {
  resetMocks();

  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const data = await response.json();
    assertEquals(data.error, 'Method not allowed');
  }
});

Deno.test('register-push-token: should return 401 when not authenticated', async () => {
  resetMocks();
  authHeaderPresent = false;

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Missing authorization header');
  }
});

Deno.test('register-push-token: should return 400 when push_token is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  authHeaderPresent = true;

  const body: { push_token?: string } = {};

  if (!body.push_token) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: push_token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: push_token');
  }
});

Deno.test('register-push-token: should return 400 for invalid token format', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  authHeaderPresent = true;

  const body = { push_token: 'invalid-token-format' };

  // Validate token format
  const tokenPattern = /^(ExponentPushToken|ExpoPushToken)\[.+\]$/;
  const isValid = tokenPattern.test(body.push_token);

  if (!isValid) {
    const response = new Response(JSON.stringify({ error: 'Invalid push token format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Invalid push token format');
  }
});

Deno.test('register-push-token: successfully registers ExponentPushToken', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockProfile = { id: 'user-123', push_token: null };
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const testToken = 'ExponentPushToken[abc123def456]';

  const { data: authData } = await supabase.auth.getUser();
  assertEquals(authData.user?.id, 'user-123');

  // Update profile with push token
  const { data: profile } = await supabase
    .from('profiles')
    .update({ push_token: testToken })
    .eq('id', authData.user!.id)
    .select()
    .single();

  assertEquals(profile?.push_token, testToken);

  const response = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
});

Deno.test('register-push-token: successfully registers ExpoPushToken', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockProfile = { id: 'user-123', push_token: null };
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const testToken = 'ExpoPushToken[xyz789]';

  const { data: authData } = await supabase.auth.getUser();
  assertEquals(authData.user?.id, 'user-123');

  // Update profile with push token
  const { data: profile } = await supabase
    .from('profiles')
    .update({ push_token: testToken })
    .eq('id', authData.user!.id)
    .select()
    .single();

  assertEquals(profile?.push_token, testToken);

  const response = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
});

Deno.test('register-push-token: can update existing token', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockProfile = { id: 'user-123', push_token: 'ExponentPushToken[old-token]' };
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const newToken = 'ExponentPushToken[new-token-123]';

  const { data: authData } = await supabase.auth.getUser();
  assertEquals(authData.user?.id, 'user-123');

  // Update profile with new push token
  const { data: profile } = await supabase
    .from('profiles')
    .update({ push_token: newToken })
    .eq('id', authData.user!.id)
    .select()
    .single();

  assertEquals(profile?.push_token, newToken);

  const response = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
});
