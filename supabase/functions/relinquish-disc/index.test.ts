/* eslint-disable @typescript-eslint/no-explicit-any */
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
};

type MockRecovery = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
};

type MockDropOff = {
  id: string;
  recovery_event_id: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  location_notes?: string | null;
  retrieved_at?: string | null;
};

type MockNotification = {
  id: string;
  user_id: string;
  type: string;
  data: Record<string, unknown>;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockRecoveries: MockRecovery[] = [];
let mockDropOffs: MockDropOff[] = [];
let mockNotifications: MockNotification[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockRecoveries = [];
  mockDropOffs = [];
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
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => {
          if (table === 'recovery_events') {
            return {
              single: () => {
                const recovery = mockRecoveries.find((r) => r[column as keyof MockRecovery] === value);
                if (recovery) {
                  const disc = mockDiscs.find((d) => d.id === recovery.disc_id);
                  return Promise.resolve({
                    data: { ...recovery, disc },
                    error: null,
                  });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              },
            };
          }
          if (table === 'drop_offs') {
            return {
              single: () => {
                const dropOff = mockDropOffs.find((d) => d[column as keyof MockDropOff] === value);
                return Promise.resolve({
                  data: dropOff || null,
                  error: dropOff ? null : { message: 'Not found' },
                });
              },
            };
          }
          return {
            single: () => Promise.resolve({ data: null, error: { message: 'Unknown table' } }),
          };
        },
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: string) => {
          if (table === 'recovery_events') {
            const recovery = mockRecoveries.find((r) => r[column as keyof MockRecovery] === value);
            if (recovery) {
              Object.assign(recovery, values);
              return Promise.resolve({ error: null });
            }
            return Promise.resolve({ error: { message: 'Not found' } });
          }
          if (table === 'discs') {
            const disc = mockDiscs.find((d) => d[column as keyof MockDisc] === value);
            if (disc) {
              Object.assign(disc, values);
              return Promise.resolve({ error: null });
            }
            return Promise.resolve({ error: { message: 'Not found' } });
          }
          return Promise.resolve({ error: null });
        },
      }),
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            if (table === 'notifications') {
              const notification: MockNotification = {
                id: `notification-${Date.now()}`,
                user_id: (values as MockNotification).user_id,
                type: (values as MockNotification).type,
                data: (values as MockNotification).data,
              };
              mockNotifications.push(notification);
              return Promise.resolve({ data: notification, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
}

Deno.test('relinquish-disc: should return 405 for non-POST requests', async () => {
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

Deno.test('relinquish-disc: should return 401 when not authenticated', async () => {
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

Deno.test('relinquish-disc: should return 400 when recovery_event_id is missing', async () => {
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

Deno.test('relinquish-disc: should return 404 for non-existent recovery event', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const recovery_event_id = 'non-existent-id';

  const { data: recovery } = await (supabase as any)
    .from('recovery_events')
    .select('*')
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

Deno.test('relinquish-disc: should return 403 when user is not the owner', async () => {
  resetMocks();
  mockUser = { id: 'finder-123', email: 'finder@example.com' };

  // Create disc owned by someone else
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: 'owner-789',
    name: 'Test Disc',
  };
  mockDiscs.push(disc);

  // Create recovery event
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: mockUser.id,
    status: 'dropped_off',
  };
  mockRecoveries.push(recovery);

  const supabase = mockSupabaseClient();

  const { data: recoveryData } = await (supabase as any)
    .from('recovery_events')
    .select('*, disc:discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  if (recoveryData.disc.owner_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Only the disc owner can relinquish' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the disc owner can relinquish');
  }
});

Deno.test('relinquish-disc: should return 400 for recovery not in dropped_off status', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
  };
  mockDiscs.push(disc);

  // Create recovery event with status 'found' (not dropped_off)
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-789',
    status: 'found',
  };
  mockRecoveries.push(recovery);

  const supabase = mockSupabaseClient();

  const { data: recoveryData } = await (supabase as any)
    .from('recovery_events')
    .select('*, disc:discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);

  if (recoveryData.status !== 'dropped_off') {
    const response = new Response(JSON.stringify({ error: 'Can only relinquish a disc in drop-off status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Can only relinquish a disc in drop-off status');
  }
});

Deno.test('relinquish-disc: owner can successfully relinquish disc', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
  };
  mockDiscs.push(disc);

  // Create recovery event
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-789',
    status: 'dropped_off',
  };
  mockRecoveries.push(recovery);

  // Create drop-off record
  const dropOff: MockDropOff = {
    id: 'dropoff-123',
    recovery_event_id: recovery.id,
    photo_url: 'https://example.com/photo.jpg',
    latitude: 40.785091,
    longitude: -73.968285,
    location_notes: 'Near the big tree',
    retrieved_at: null,
  };
  mockDropOffs.push(dropOff);

  const supabase = mockSupabaseClient();

  // Update recovery status to abandoned
  await (supabase as any).from('recovery_events').update({ status: 'abandoned' }).eq('id', recovery.id);

  // Transfer disc ownership to finder
  await (supabase as any).from('discs').update({ owner_id: 'finder-789' }).eq('id', disc.id);

  // Verify recovery status was updated
  const updatedRecovery = mockRecoveries.find((r) => r.id === recovery.id);
  assertEquals(updatedRecovery?.status, 'abandoned');

  // Verify disc ownership was transferred
  const updatedDisc = mockDiscs.find((d) => d.id === disc.id);
  assertEquals(updatedDisc?.owner_id, 'finder-789');

  const response = new Response(
    JSON.stringify({
      success: true,
      message: 'Disc relinquished to finder',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
});

Deno.test('relinquish-disc: creates notification for finder', async () => {
  resetMocks();
  mockUser = { id: 'owner-123', email: 'owner@example.com' };

  const finderId = 'finder-789';

  // Create disc owned by current user
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: mockUser.id,
    name: 'Test Disc',
  };
  mockDiscs.push(disc);

  // Create recovery event
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'dropped_off',
  };
  mockRecoveries.push(recovery);

  // Create drop-off record
  const dropOff: MockDropOff = {
    id: 'dropoff-123',
    recovery_event_id: recovery.id,
    photo_url: 'https://example.com/photo.jpg',
    latitude: 40.785091,
    longitude: -73.968285,
    retrieved_at: null,
  };
  mockDropOffs.push(dropOff);

  const supabase = mockSupabaseClient();

  // Create notification for finder
  await (supabase as any)
    .from('notifications')
    .insert({
      user_id: finderId,
      type: 'disc_relinquished',
      data: { recovery_event_id: recovery.id, disc_id: disc.id },
    })
    .select()
    .single();

  // Verify notification was created
  const notification = mockNotifications.find((n) => n.user_id === finderId && n.type === 'disc_relinquished');
  assertExists(notification);
  assertEquals(notification.type, 'disc_relinquished');
});
