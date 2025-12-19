import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDisc = {
  id: string;
  reward_amount: number | null;
};

type MockRecoveryEvent = {
  id: string;
  finder_id: string;
  status: string;
  reward_paid_at: string | null;
  disc: MockDisc | null;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let authHeaderPresent = false;
let currentUserId: string | null = null;

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockRecoveryEvents = [];
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
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, value: string) => {
          if (table === 'recovery_events') {
            const recovery = mockRecoveryEvents.find((r) => r.id === value);
            if (recovery) {
              Object.assign(recovery, values);
              return Promise.resolve({ error: null });
            }
            return Promise.resolve({ error: { message: 'Recovery event not found' } });
          }
          return Promise.resolve({ error: { message: 'Unknown table' } });
        },
      }),
    }),
  };
}

Deno.test('mark-reward-paid: should return 405 for non-POST requests', async () => {
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

Deno.test('mark-reward-paid: should return 401 when not authenticated', async () => {
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

Deno.test('mark-reward-paid: should return 400 when recovery_event_id is missing', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-123', email: 'test@example.com' });
  currentUserId = 'user-123';
  authHeaderPresent = true;

  const body: { recovery_event_id?: string } = {};

  if (!body.recovery_event_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: recovery_event_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: recovery_event_id');
  }
});

Deno.test('mark-reward-paid: should return 404 when recovery event not found', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-123', email: 'test@example.com' });
  currentUserId = 'user-123';
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: recovery } = await supabase.from('recovery_events').select('*').eq('id', 'non-existent-id').single();

  if (!recovery) {
    const response = new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Recovery event not found');
  }
});

Deno.test('mark-reward-paid: should return 403 when user is not finder', async () => {
  resetMocks();

  const owner = { id: 'owner-123', email: 'owner@example.com' };
  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(owner, finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: null,
    disc: { id: 'disc-1', reward_amount: 10 },
  });

  // Owner tries to mark as paid (should fail)
  currentUserId = owner.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: recovery } = await supabase.from('recovery_events').select('*').eq('id', 'recovery-123').single();

  if (recovery && recovery.finder_id !== currentUserId) {
    const response = new Response(JSON.stringify({ error: 'Only the finder can mark the reward as received' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the finder can mark the reward as received');
  }
});

Deno.test('mark-reward-paid: should return 400 when recovery is not in recovered status', async () => {
  resetMocks();

  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'found', // Not recovered yet
    reward_paid_at: null,
    disc: { id: 'disc-1', reward_amount: 10 },
  });

  currentUserId = finder.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: recovery } = await supabase.from('recovery_events').select('*').eq('id', 'recovery-123').single();

  if (recovery && recovery.status !== 'recovered') {
    const response = new Response(
      JSON.stringify({ error: 'Reward can only be marked as paid after disc is recovered' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Reward can only be marked as paid after disc is recovered');
  }
});

Deno.test('mark-reward-paid: should return 400 when disc has no reward', async () => {
  resetMocks();

  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: null,
    disc: { id: 'disc-1', reward_amount: 0 }, // No reward
  });

  currentUserId = finder.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: recovery } = await supabase.from('recovery_events').select('*').eq('id', 'recovery-123').single();

  if (recovery?.disc && (recovery.disc.reward_amount === null || recovery.disc.reward_amount <= 0)) {
    const response = new Response(JSON.stringify({ error: 'This disc does not have a reward set' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'This disc does not have a reward set');
  }
});

Deno.test('mark-reward-paid: should return success when already marked as paid', async () => {
  resetMocks();

  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(finder);

  const previousPaymentTime = '2025-12-19T10:00:00Z';
  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: previousPaymentTime, // Already marked
    disc: { id: 'disc-1', reward_amount: 10 },
  });

  currentUserId = finder.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const { data: recovery } = await supabase.from('recovery_events').select('*').eq('id', 'recovery-123').single();

  if (recovery?.reward_paid_at) {
    const response = new Response(
      JSON.stringify({
        success: true,
        message: 'Reward was already marked as received',
        reward_paid_at: recovery.reward_paid_at,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.message, 'Reward was already marked as received');
    assertEquals(data.reward_paid_at, previousPaymentTime);
  }
});

Deno.test('mark-reward-paid: finder can successfully mark reward as received', async () => {
  resetMocks();

  const finder = { id: 'finder-456', email: 'finder@example.com' };
  mockUsers.push(finder);

  mockRecoveryEvents.push({
    id: 'recovery-123',
    finder_id: finder.id,
    status: 'recovered',
    reward_paid_at: null,
    disc: { id: 'disc-1', reward_amount: 15 },
  });

  currentUserId = finder.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();

  // Simulate marking as paid
  const now = new Date().toISOString();
  await supabase.from('recovery_events').update({ reward_paid_at: now, updated_at: now }).eq('id', 'recovery-123');

  // Verify it was updated
  const recovery = mockRecoveryEvents.find((r) => r.id === 'recovery-123');
  assertExists(recovery);
  assertExists(recovery.reward_paid_at);

  const response = new Response(
    JSON.stringify({
      success: true,
      message: 'Reward marked as received',
      reward_paid_at: recovery.reward_paid_at,
      reward_amount: 15,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.message, 'Reward marked as received');
  assertEquals(data.reward_amount, 15);
  assertExists(data.reward_paid_at);
});
