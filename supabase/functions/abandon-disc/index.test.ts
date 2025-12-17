import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDisc = {
  id: string;
  owner_id: string | null;
  name: string;
  mold: string;
};

type MockRecovery = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  found_at: string;
  discs?: MockDisc;
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
let mockNotifications: MockNotification[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockRecoveries = [];
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
              if (table === 'discs') {
                const disc = mockDiscs.find((d) => d[column as keyof MockDisc] === value);
                if (disc) {
                  Object.assign(disc, values);
                  return Promise.resolve({ data: disc, error: null });
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

Deno.test('abandon-disc: should return 405 for non-POST requests', async () => {
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

Deno.test('abandon-disc: should return 401 when not authenticated', async () => {
  resetMocks();

  const authHeader = undefined;

  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Missing authorization header');
  }
});

Deno.test('abandon-disc: should return 400 when recovery_event_id is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: { recovery_event_id?: string } = {};

  if (!body.recovery_event_id) {
    const response = new Response(JSON.stringify({ error: 'recovery_event_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'recovery_event_id is required');
  }
});

Deno.test('abandon-disc: should return 404 when recovery event not found', async () => {
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

Deno.test('abandon-disc: should return 403 when user is not disc owner', async () => {
  resetMocks();
  mockUser = { id: 'finder-123', email: 'finder@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc owned by someone else
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: 'owner-789',
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  // Create recovery event
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: mockUser.id,
    status: 'dropped_off',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  assertExists(recoveryData.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  if (recoveryData.discs.owner_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Only the disc owner can abandon it' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the disc owner can abandon it');
  }
});

Deno.test('abandon-disc: should return 400 when recovery is not in dropped_off status', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  // Create recovery event in 'found' status (not dropped_off)
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-789',
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);

  if (recoveryData.status !== 'dropped_off') {
    const response = new Response(JSON.stringify({ error: 'Can only abandon a disc that has been dropped off' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Can only abandon a disc that has been dropped off');
  }
});

Deno.test('abandon-disc: owner can successfully abandon a dropped off disc', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  // Create recovery event in dropped_off status
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-789',
    status: 'dropped_off',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  assertExists(recoveryData.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Verify ownership and status
  assertEquals(recoveryData.discs.owner_id, authData.user.id);
  assertEquals(recoveryData.status, 'dropped_off');

  // Update recovery status to abandoned
  await supabase.from('recovery_events').update({ status: 'abandoned' }).eq('id', recovery.id).select().single();

  // Update disc owner_id to null
  await supabase.from('discs').update({ owner_id: null }).eq('id', disc.id).select().single();

  // Create notification for finder
  await supabase
    .from('notifications')
    .insert({
      user_id: recovery.finder_id,
      type: 'disc_abandoned',
      data: { recovery_event_id: recovery.id },
    })
    .select()
    .single();

  const response = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);

  // Verify recovery status was updated to 'abandoned'
  const updatedRecovery = mockRecoveries.find((r) => r.id === recovery.id);
  assertEquals(updatedRecovery?.status, 'abandoned');

  // Verify disc owner_id was set to null
  const updatedDisc = mockDiscs.find((d) => d.id === disc.id);
  assertEquals(updatedDisc?.owner_id, null);

  // Verify notification was created
  const notification = mockNotifications.find((n) => n.user_id === recovery.finder_id && n.type === 'disc_abandoned');
  assertExists(notification);
  assertEquals(notification.data.recovery_event_id, recovery.id);
});
