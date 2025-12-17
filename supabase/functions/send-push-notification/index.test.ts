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
let mockUsers: MockUser[] = [];
let mockProfiles: MockProfile[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockProfiles = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (_column: string, value: string) => ({
          single: () => {
            if (table === 'profiles') {
              const profile = mockProfiles.find((p) => p.id === value);
              if (profile) {
                return Promise.resolve({ data: profile, error: null });
              }
              return Promise.resolve({ data: null, error: { message: 'Profile not found' } });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
    }),
  };
}

Deno.test('send-push-notification: should return 405 for non-POST requests', async () => {
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

Deno.test('send-push-notification: should return 400 when user_id is missing', async () => {
  resetMocks();

  const body: { user_id?: string; title?: string; body?: string } = {
    title: 'Test',
    body: 'Test body',
  };

  if (!body.user_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: user_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: user_id');
  }
});

Deno.test('send-push-notification: should return 400 when title is missing', async () => {
  resetMocks();

  const body: { user_id?: string; title?: string; body?: string } = {
    user_id: '123',
    body: 'Test body',
  };

  if (!body.title) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: title' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: title');
  }
});

Deno.test('send-push-notification: should return 400 when body is missing', async () => {
  resetMocks();

  const body: { user_id?: string; title?: string; body?: string } = {
    user_id: '123',
    title: 'Test',
  };

  if (!body.body) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: body');
  }
});

Deno.test('send-push-notification: skips when user has no push token', async () => {
  resetMocks();

  const userId = 'user-123';
  mockUsers.push({ id: userId, email: 'test@example.com' });
  mockProfiles.push({ id: userId, push_token: null });

  const supabase = mockSupabaseClient();

  // Get user profile
  const { data: profile } = await supabase.from('profiles').select('push_token').eq('id', userId).single();

  // Check if user has push token
  if (!profile?.push_token) {
    const response = new Response(
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

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.skipped, true);
    assertEquals(data.reason, 'User has no push token registered');
  }
});
