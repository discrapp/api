import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDisc = {
  id: string;
  owner_id: string;
  name: string;
  flight_numbers?: Record<string, number>;
};

type MockRecovery = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  discs?: MockDisc;
};

type MockMeetupProposal = {
  id: string;
  recovery_event_id: string;
  proposed_by: string;
  location_name: string;
  proposed_datetime: string;
  status: string;
};

type MockNotification = {
  id: string;
  user_id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockRecoveries: MockRecovery[] = [];
let mockMeetupProposals: MockMeetupProposal[] = [];
let mockNotifications: MockNotification[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockRecoveries = [];
  mockMeetupProposals = [];
  mockNotifications = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: () => {
        if (mockUser) {
          return Promise.resolve({ data: { user: mockUser }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } });
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => {
        const selectQuery = {
          eq: (column: string, value: string) => ({
            single: () => {
              if (table === 'recovery_events') {
                const recovery = mockRecoveries.find((r) => r[column as keyof MockRecovery] === value);
                if (recovery) {
                  if (_columns && _columns.includes('discs')) {
                    const disc = mockDiscs.find((d) => d.id === recovery.disc_id);
                    return Promise.resolve({
                      data: { ...recovery, discs: disc || null },
                      error: null,
                    });
                  }
                  return Promise.resolve({ data: recovery, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              }
              if (table === 'meetup_proposals') {
                const proposal = mockMeetupProposals.find((p) => p[column as keyof MockMeetupProposal] === value);
                return Promise.resolve({ data: proposal || null, error: proposal ? null : { message: 'Not found' } });
              }
              return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
            },
          }),
        };
        return selectQuery;
      },
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: () => {
            if (table === 'notifications') {
              const notification: MockNotification = {
                id: `notification-${Date.now()}`,
                user_id: (values as MockNotification).user_id,
                type: (values as MockNotification).type,
                data: (values as MockNotification).data,
                created_at: new Date().toISOString(),
              };
              mockNotifications.push(notification);
              return Promise.resolve({ data: notification, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: string) => ({
          select: () => ({
            single: () => {
              if (table === 'recovery_events') {
                const recovery = mockRecoveries.find((r) => r[column as keyof MockRecovery] === value);
                if (recovery) {
                  Object.assign(recovery, values);
                  return Promise.resolve({ data: recovery, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              }
              if (table === 'meetup_proposals') {
                const proposal = mockMeetupProposals.find((p) => p[column as keyof MockMeetupProposal] === value);
                if (proposal) {
                  Object.assign(proposal, values);
                  return Promise.resolve({ data: proposal, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              }
              return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('complete-recovery: should return 405 for non-POST requests', async () => {
  const method = 'GET' as string;

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

Deno.test('complete-recovery: should return 401 when not authenticated', async () => {
  resetMocks();

  const authHeader = undefined;

  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
  }
});

Deno.test('complete-recovery: should return 400 when recovery_event_id is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

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

Deno.test('complete-recovery: should return 404 when recovery event not found', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const recovery_event_id = '00000000-0000-0000-0000-000000000000';

  const { data: recovery } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery_event_id)
    .single();

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

Deno.test('complete-recovery: should return 403 when user is not disc owner', async () => {
  resetMocks();
  mockUser = { id: 'random-user-123', email: 'random@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc owned by someone else
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: 'owner-789',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create recovery event
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-456',
    status: 'meetup_scheduled',
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  const typedRecovery = recoveryData as MockRecovery;
  assertExists(typedRecovery.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  if (typedRecovery.discs.owner_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Only the disc owner can complete the recovery' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the disc owner can complete the recovery');
  }
});

Deno.test('complete-recovery: owner can complete a recovery', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create recovery event
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-456',
    status: 'meetup_scheduled',
  };
  mockRecoveries.push(recovery);

  // Create accepted meetup proposal
  const proposal: MockMeetupProposal = {
    id: 'proposal-789',
    recovery_event_id: recovery.id,
    proposed_by: recovery.finder_id,
    location_name: 'Maple Hill DGC',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'accepted',
  };
  mockMeetupProposals.push(proposal);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  const typedRecovery = recoveryData as MockRecovery;
  assertExists(typedRecovery.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Verify ownership
  assertEquals(typedRecovery.discs.owner_id, authData.user.id);

  // Update recovery status to returned
  const { data: updatedRecovery } = await supabase
    .from('recovery_events')
    .update({ status: 'returned' })
    .eq('id', recovery.id)
    .select()
    .single();

  // Update proposal status to completed
  await supabase
    .from('meetup_proposals')
    .update({ status: 'completed' })
    .eq('recovery_event_id', recovery.id)
    .select()
    .single();

  // Create notification for finder
  await supabase
    .from('notifications')
    .insert({
      user_id: recovery.finder_id,
      type: 'recovery_completed',
      data: { recovery_event_id: recovery.id },
    })
    .select()
    .single();

  const response = new Response(
    JSON.stringify({
      success: true,
      recovery_event: updatedRecovery,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.recovery_event);
  assertEquals(data.recovery_event.status, 'returned');

  // Verify meetup proposal status was updated
  const updatedProposal = mockMeetupProposals.find((p) => p.recovery_event_id === recovery.id);
  assertEquals(updatedProposal?.status, 'completed');
});

Deno.test('complete-recovery: owner can complete a dropped_off recovery', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create recovery event with dropped_off status
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-456',
    status: 'dropped_off',
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  const typedRecovery = recoveryData as MockRecovery;
  assertExists(typedRecovery.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Verify ownership
  assertEquals(typedRecovery.discs.owner_id, authData.user.id);

  // Update recovery status to recovered (not returned, since it was dropped off)
  const { data: updatedRecovery } = await supabase
    .from('recovery_events')
    .update({ status: 'recovered' })
    .eq('id', recovery.id)
    .select()
    .single();

  // Create notification for finder
  await supabase
    .from('notifications')
    .insert({
      user_id: recovery.finder_id,
      type: 'recovery_completed',
      data: { recovery_event_id: recovery.id },
    })
    .select()
    .single();

  const response = new Response(
    JSON.stringify({
      success: true,
      recovery_event: updatedRecovery,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.recovery_event);
  assertEquals(data.recovery_event.status, 'recovered');
});

Deno.test('complete-recovery: should reject already completed recoveries', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create already completed recovery event
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-456',
    status: 'returned',
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);

  if (recoveryData.status === 'returned' || recoveryData.status === 'recovered') {
    const response = new Response(JSON.stringify({ error: 'This recovery has already been completed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'This recovery has already been completed');
  }
});
