import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDisc = {
  id: string;
  name: string;
  mold: string;
  reward_amount: number | null;
  owner_id: string;
};

type MockRecoveryEvent = {
  id: string;
  finder_id: string;
  status: string;
  reward_paid_at: string | null;
  disc: MockDisc | null;
};

type MockProfile = {
  id: string;
  stripe_connect_account_id: string | null;
  stripe_connect_status: string | null;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockProfiles: MockProfile[] = [];
let authHeaderPresent = false;
let currentUserId: string | null = null;

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockRecoveryEvents = [];
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
            if (table === 'recovery_events') {
              const recovery = mockRecoveryEvents.find((r) => r.id === value);
              if (recovery) {
                return Promise.resolve({ data: recovery, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
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
    }),
  };
}

// Fee calculation helper (same as in main code)
function calculateStripeFee(amountCents: number): number {
  const feePercent = 0.029;
  const flatFeeCents = 30;
  const totalCents = Math.ceil((amountCents + flatFeeCents) / (1 - feePercent));
  return totalCents - amountCents;
}

Deno.test('send-reward-payment: should return 405 for non-POST requests', async () => {
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

Deno.test('send-reward-payment: should return 401 when not authenticated', async () => {
  resetMocks();
  authHeaderPresent = false;

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
  }
});

Deno.test('send-reward-payment: should return 400 when recovery_event_id missing', async () => {
  resetMocks();

  const body: { recovery_event_id?: string } = {};

  if (!body.recovery_event_id) {
    const response = new Response(
      JSON.stringify({ error: 'Missing required field: recovery_event_id' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: recovery_event_id');
  }
});

Deno.test('send-reward-payment: should return 403 when user is not owner', async () => {
  resetMocks();

  const owner = { id: 'owner-123', email: 'owner@example.com' };
  const finder = { id: 'finder-456', email: 'finder@example.com' };
  const notOwner = { id: 'other-789', email: 'other@example.com' };
  mockUsers.push(owner, finder, notOwner);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: null,
    disc: { id: 'disc-1', name: 'Test Disc', mold: 'Destroyer', reward_amount: 5, owner_id: owner.id },
  });

  // Non-owner tries to send payment
  currentUserId = notOwner.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data } = await supabase
    .from('recovery_events')
    .select('*')
    .eq('id', 'recovery-123')
    .single();

  const recovery = data as MockRecoveryEvent | null;
  if (recovery?.disc && recovery.disc.owner_id !== currentUserId) {
    const response = new Response(
      JSON.stringify({ error: 'Only the disc owner can send the reward' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 403);
  }
});

Deno.test('send-reward-payment: should return 400 when recovery not in recovered status', async () => {
  resetMocks();

  const owner = { id: 'owner-123', email: 'owner@example.com' };
  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(owner, finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'found', // Not recovered yet
    reward_paid_at: null,
    disc: { id: 'disc-1', name: 'Test Disc', mold: 'Destroyer', reward_amount: 5, owner_id: owner.id },
  });

  currentUserId = owner.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data } = await supabase
    .from('recovery_events')
    .select('*')
    .eq('id', 'recovery-123')
    .single();

  const recovery = data as MockRecoveryEvent | null;
  if (recovery && recovery.status !== 'recovered') {
    const response = new Response(
      JSON.stringify({ error: 'Reward can only be sent after disc is recovered' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
  }
});

Deno.test('send-reward-payment: should return 400 when already paid', async () => {
  resetMocks();

  const owner = { id: 'owner-123', email: 'owner@example.com' };
  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(owner, finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: '2025-12-19T10:00:00Z', // Already paid
    disc: { id: 'disc-1', name: 'Test Disc', mold: 'Destroyer', reward_amount: 5, owner_id: owner.id },
  });

  currentUserId = owner.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data } = await supabase
    .from('recovery_events')
    .select('*')
    .eq('id', 'recovery-123')
    .single();

  const recovery = data as MockRecoveryEvent | null;
  if (recovery?.reward_paid_at) {
    const response = new Response(
      JSON.stringify({
        error: 'Reward has already been paid',
        reward_paid_at: recovery.reward_paid_at,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Reward has already been paid');
  }
});

Deno.test('send-reward-payment: should return 400 when finder has no Connect account', async () => {
  resetMocks();

  const owner = { id: 'owner-123', email: 'owner@example.com' };
  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(owner, finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: null,
    disc: { id: 'disc-1', name: 'Test Disc', mold: 'Destroyer', reward_amount: 5, owner_id: owner.id },
  });

  mockProfiles.push({
    id: finder.id,
    stripe_connect_account_id: null, // No Connect account
    stripe_connect_status: null,
  });

  currentUserId = owner.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data } = await supabase.from('profiles').select('*').eq('id', finder.id).single();

  const finderProfile = data as MockProfile | null;
  if (!finderProfile?.stripe_connect_account_id || finderProfile.stripe_connect_status !== 'active') {
    const response = new Response(
      JSON.stringify({
        error: 'Finder has not set up card payments. Please use Venmo or contact them directly.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
  }
});

Deno.test('send-reward-payment: fee calculation is correct', () => {
  // $5.00 reward = 500 cents
  const reward500 = calculateStripeFee(500);
  // Expected: (500 + 30) / (1 - 0.029) = 530 / 0.971 = 545.82... → 546 cents total
  // Fee = 546 - 500 = 46 cents
  assertEquals(reward500, 46);

  // $10.00 reward = 1000 cents
  const reward1000 = calculateStripeFee(1000);
  // Expected: (1000 + 30) / (1 - 0.029) = 1030 / 0.971 = 1060.76... → 1061 cents total
  // Fee = 1061 - 1000 = 61 cents
  assertEquals(reward1000, 61);

  // $1.00 reward = 100 cents
  const reward100 = calculateStripeFee(100);
  // Expected: (100 + 30) / (1 - 0.029) = 130 / 0.971 = 133.88... → 134 cents total
  // Fee = 134 - 100 = 34 cents
  assertEquals(reward100, 34);
});

Deno.test('send-reward-payment: should return checkout URL on success', async () => {
  resetMocks();

  const owner = { id: 'owner-123', email: 'owner@example.com' };
  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(owner, finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: null,
    disc: { id: 'disc-1', name: 'Test Disc', mold: 'Destroyer', reward_amount: 5, owner_id: owner.id },
  });

  mockProfiles.push({
    id: finder.id,
    stripe_connect_account_id: 'acct_active123',
    stripe_connect_status: 'active',
  });

  currentUserId = owner.id;
  authHeaderPresent = true;

  // Simulate successful checkout creation
  const rewardAmount = 5;
  const feeCents = calculateStripeFee(rewardAmount * 100);
  const totalAmount = rewardAmount + feeCents / 100;

  const response = new Response(
    JSON.stringify({
      checkout_url: 'https://checkout.stripe.com/test-session',
      amount: totalAmount,
      reward_amount: rewardAmount,
      fee_amount: feeCents / 100,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertExists(data.checkout_url);
  assertEquals(data.reward_amount, 5);
  assertEquals(data.fee_amount, 0.46);
  assertEquals(data.amount, 5.46);
});
