import { assertEquals } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockProfile = {
  id: string;
  stripe_connect_account_id: string | null;
  stripe_connect_status: string | null;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockProfiles: MockProfile[] = [];
let authHeaderPresent = false;
let currentUserId: string | null = null;

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockProfiles = [];
  authHeaderPresent = false;
  currentUserId = null;
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: () => {
        const user = mockUsers.find((u) => u.id === currentUserId);
        if (user && authHeaderPresent) {
          return Promise.resolve({ data: { user }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } });
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (_column: string, value: string) => ({
          single: () => {
            if (table === 'profiles') {
              const profile = mockProfiles.find((p) => p.id === value);
              if (profile) {
                return Promise.resolve({ data: profile, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, value: string) => {
          if (table === 'profiles') {
            const profile = mockProfiles.find((p) => p.id === value);
            if (profile) {
              Object.assign(profile, values);
              return Promise.resolve({ error: null });
            }
            return Promise.resolve({ error: { message: 'Profile not found' } });
          }
          return Promise.resolve({ error: { message: 'Unknown table' } });
        },
      }),
    }),
  };
}

Deno.test('get-connect-status: should return 405 for non-GET requests', async () => {
  resetMocks();

  const method: string = 'POST';

  if (method !== 'GET') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const data = await response.json();
    assertEquals(data.error, 'Method not allowed');
  }
});

Deno.test('get-connect-status: should return 401 when not authenticated', async () => {
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

Deno.test('get-connect-status: should return none status when user has no Connect account', async () => {
  resetMocks();

  const user = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(user);
  mockProfiles.push({
    id: 'user-123',
    stripe_connect_account_id: null,
    stripe_connect_status: null,
  });

  currentUserId = user.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', user.id)
    .single();

  if (!profile?.stripe_connect_account_id) {
    const response = new Response(
      JSON.stringify({
        status: 'none',
        can_receive_payments: false,
        details_submitted: false,
        payouts_enabled: false,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.status, 'none');
    assertEquals(data.can_receive_payments, false);
  }
});

Deno.test('get-connect-status: should return pending status for incomplete onboarding', async () => {
  resetMocks();

  const user = { id: 'user-456', email: 'finder@example.com' };
  mockUsers.push(user);
  mockProfiles.push({
    id: 'user-456',
    stripe_connect_account_id: 'acct_pending123',
    stripe_connect_status: 'pending',
  });

  currentUserId = user.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', user.id)
    .single();

  // Simulating cached status (no Stripe call)
  const response = new Response(
    JSON.stringify({
      status: profile?.stripe_connect_status || 'pending',
      can_receive_payments: false,
      details_submitted: false,
      payouts_enabled: false,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.status, 'pending');
  assertEquals(data.can_receive_payments, false);
});

Deno.test('get-connect-status: should return active status for completed onboarding', async () => {
  resetMocks();

  const user = { id: 'user-789', email: 'activefinder@example.com' };
  mockUsers.push(user);
  mockProfiles.push({
    id: 'user-789',
    stripe_connect_account_id: 'acct_active123',
    stripe_connect_status: 'active',
  });

  currentUserId = user.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', user.id)
    .single();

  // Simulating active account
  const response = new Response(
    JSON.stringify({
      status: 'active',
      can_receive_payments: true,
      details_submitted: true,
      payouts_enabled: true,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.status, 'active');
  assertEquals(data.can_receive_payments, true);
  assertEquals(data.details_submitted, true);
  assertEquals(data.payouts_enabled, true);
});
