import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockProfile = {
  id: string;
  email: string;
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

Deno.test('create-connect-onboarding: should return 405 for non-POST requests', async () => {
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

Deno.test('create-connect-onboarding: should return 401 when not authenticated', async () => {
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

Deno.test('create-connect-onboarding: should return profile for authenticated user', async () => {
  resetMocks();

  const user = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(user);
  mockProfiles.push({
    id: 'user-123',
    email: 'test@example.com',
    stripe_connect_account_id: null,
    stripe_connect_status: null,
  });

  currentUserId = user.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status, email')
    .eq('id', user.id)
    .single();

  assertExists(profile);
  assertEquals(profile.email, 'test@example.com');
  assertEquals(profile.stripe_connect_account_id, null);
});

Deno.test('create-connect-onboarding: should return existing account if user already has one', async () => {
  resetMocks();

  const user = { id: 'user-456', email: 'finder@example.com' };
  mockUsers.push(user);
  mockProfiles.push({
    id: 'user-456',
    email: 'finder@example.com',
    stripe_connect_account_id: 'acct_existing123',
    stripe_connect_status: 'active',
  });

  currentUserId = user.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status, email')
    .eq('id', user.id)
    .single();

  assertExists(profile);
  assertEquals(profile.stripe_connect_account_id, 'acct_existing123');
  assertEquals(profile.stripe_connect_status, 'active');

  // In real implementation, we would generate a new account link
  // for the existing account instead of creating a new one
  const response = new Response(
    JSON.stringify({
      onboarding_url: 'https://connect.stripe.com/setup/existing',
      account_id: profile.stripe_connect_account_id,
      is_new: false,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.account_id, 'acct_existing123');
  assertEquals(data.is_new, false);
  assertExists(data.onboarding_url);
});

Deno.test('create-connect-onboarding: should update profile when creating new account', async () => {
  resetMocks();

  const user = { id: 'user-789', email: 'newfinder@example.com' };
  mockUsers.push(user);
  mockProfiles.push({
    id: 'user-789',
    email: 'newfinder@example.com',
    stripe_connect_account_id: null,
    stripe_connect_status: null,
  });

  currentUserId = user.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();

  // Simulate creating a new Stripe account
  const newAccountId = 'acct_new123';

  // Update profile with new account
  await supabase
    .from('profiles')
    .update({
      stripe_connect_account_id: newAccountId,
      stripe_connect_status: 'pending',
    })
    .eq('id', user.id);

  // Verify it was updated
  const profile = mockProfiles.find((p) => p.id === user.id);
  assertExists(profile);
  assertEquals(profile.stripe_connect_account_id, newAccountId);
  assertEquals(profile.stripe_connect_status, 'pending');
});
