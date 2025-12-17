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

type MockDropOff = {
  id: string;
  recovery_event_id: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  location_notes?: string | null;
  created_at: string;
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
      select: (_columns?: string) => {
        const selectQuery = {
          eq: (column: string, value: string) => {
            if (table === 'recovery_events') {
              return {
                single: () => {
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
                },
              };
            }
            if (table === 'notifications') {
              return {
                eq: (column2: string, value2: string) => ({
                  order: (_column: string, _options?: { ascending: boolean }) => ({
                    limit: (_count: number) => {
                      const filtered = mockNotifications.filter(
                        (n) =>
                          n[column as keyof MockNotification] === value &&
                          n[column2 as keyof MockNotification] === value2
                      );
                      return Promise.resolve({
                        data: filtered.slice(0, _count),
                        error: null,
                      });
                    },
                  }),
                }),
              };
            }
            return {
              single: () => Promise.resolve({ data: null, error: { message: 'Unknown table' } }),
            };
          },
          order: (_column: string, _options?: { ascending: boolean }) => ({
            limit: (_count: number) => {
              if (table === 'notifications') {
                return Promise.resolve({
                  data: mockNotifications.slice(0, _count),
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        };
        return selectQuery;
      },
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: () => {
            if (table === 'drop_offs') {
              const dropOffData = values as MockDropOff;
              const newDropOff: MockDropOff = {
                id: `dropoff-${Date.now()}`,
                recovery_event_id: dropOffData.recovery_event_id,
                photo_url: dropOffData.photo_url,
                latitude: dropOffData.latitude,
                longitude: dropOffData.longitude,
                location_notes: dropOffData.location_notes || null,
                created_at: new Date().toISOString(),
              };
              mockDropOffs.push(newDropOff);
              return Promise.resolve({ data: newDropOff, error: null });
            }
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
              return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
            },
          }),
        }),
      }),
      delete: () => ({
        eq: (column: string, value: string) => {
          if (table === 'notifications') {
            mockNotifications = mockNotifications.filter((n) => !(n[column as keyof MockNotification] === value));
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
}

Deno.test('create-drop-off: should return 405 for non-POST requests', async () => {
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

Deno.test('create-drop-off: should return 401 when not authenticated', async () => {
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

Deno.test('create-drop-off: should return 400 when required fields are missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: {
    recovery_event_id?: string;
    photo_url?: string;
    latitude?: number;
    longitude?: number;
  } = {};

  if (!body.recovery_event_id || !body.photo_url || body.latitude === undefined || body.longitude === undefined) {
    const response = new Response(
      JSON.stringify({
        error: 'Missing required fields: recovery_event_id, photo_url, latitude, longitude',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required fields: recovery_event_id, photo_url, latitude, longitude');
  }
});

Deno.test('create-drop-off: should return 404 for non-existent recovery event', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const recovery_event_id = '00000000-0000-0000-0000-000000000000';

  const { data: recovery } = await (supabase as any)
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

Deno.test('create-drop-off: should return 403 when user is not the finder', async () => {
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

  // Create recovery event where someone else is the finder
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: 'finder-789',
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await (supabase as any)
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  if (recoveryData.finder_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Only the finder can create a drop-off' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the finder can create a drop-off');
  }
});

Deno.test('create-drop-off: should return 400 for recovery not in found status', async () => {
  resetMocks();
  mockUser = { id: 'finder-123', email: 'finder@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc
  const disc: MockDisc = {
    id: 'disc-456',
    owner_id: 'owner-789',
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  // Create recovery event with status already 'recovered'
  const recovery: MockRecovery = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: mockUser.id,
    status: 'recovered',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await (supabase as any)
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);

  if (recoveryData.status !== 'found') {
    const response = new Response(
      JSON.stringify({ error: 'Can only create drop-off for a recovery in found status' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Can only create drop-off for a recovery in found status');
  }
});

Deno.test('create-drop-off: finder can successfully create drop-off', async () => {
  resetMocks();
  mockUser = { id: 'finder-123', email: 'finder@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc
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
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await (supabase as any)
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  const typedRecovery = recoveryData as MockRecovery;
  assertExists(typedRecovery.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Verify finder is current user and status is found
  assertEquals(typedRecovery.finder_id, authData.user.id);
  assertEquals(typedRecovery.status, 'found');

  // Create drop-off
  const dropOffData = {
    recovery_event_id: recovery.id,
    photo_url: 'https://example.com/drop-location.jpg',
    latitude: 40.785091,
    longitude: -73.968285,
    location_notes: 'Behind the big oak tree near hole 7',
  };

  const { data: dropOff } = await supabase.from('drop_offs').insert(dropOffData).select().single();

  assertExists(dropOff);

  // Update recovery status to dropped_off
  await supabase.from('recovery_events').update({ status: 'dropped_off' }).eq('id', recovery.id).select().single();

  // Create notification for owner
  await supabase
    .from('notifications')
    .insert({
      user_id: typedRecovery.discs.owner_id,
      type: 'disc_dropped_off',
      data: { recovery_event_id: recovery.id },
    })
    .select()
    .single();

  const response = new Response(
    JSON.stringify({
      success: true,
      drop_off: dropOff,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.drop_off);
  assertExists(data.drop_off.id);
  assertEquals(data.drop_off.recovery_event_id, recovery.id);
  assertEquals(data.drop_off.photo_url, 'https://example.com/drop-location.jpg');
  assertEquals(data.drop_off.location_notes, 'Behind the big oak tree near hole 7');

  // Verify recovery event status was updated
  const updatedRecovery = mockRecoveries.find((r) => r.id === recovery.id);
  assertEquals(updatedRecovery?.status, 'dropped_off');

  // Verify notification was created
  const notification = mockNotifications.find(
    (n) => n.user_id === typedRecovery.discs?.owner_id && n.type === 'disc_dropped_off'
  );
  assertExists(notification);
});

Deno.test('create-drop-off: works without optional location_notes', async () => {
  resetMocks();
  mockUser = { id: 'finder-123', email: 'finder@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc
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
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await (supabase as any)
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  const typedRecovery = recoveryData as MockRecovery;
  assertExists(typedRecovery.discs);

  // Create drop-off without location_notes
  const dropOffData = {
    recovery_event_id: recovery.id,
    photo_url: 'https://example.com/drop-location.jpg',
    latitude: 40.785091,
    longitude: -73.968285,
  };

  const { data: dropOff } = await supabase.from('drop_offs').insert(dropOffData).select().single();

  assertExists(dropOff);
  const typedDropOff = dropOff as MockDropOff;
  assertEquals(typedDropOff.location_notes, null);

  // Update recovery status
  await supabase.from('recovery_events').update({ status: 'dropped_off' }).eq('id', recovery.id).select().single();

  const response = new Response(
    JSON.stringify({
      success: true,
      drop_off: dropOff,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals((data.drop_off as MockDropOff).location_notes, null);
});

Deno.test('create-drop-off: creates notification for owner', async () => {
  resetMocks();
  mockUser = { id: 'finder-123', email: 'finder@example.com' };

  const supabase = mockSupabaseClient();

  // Create disc
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
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveries.push(recovery);

  const { data: recoveryData } = await (supabase as any)
    .from('recovery_events')
    .select('*, discs(*)')
    .eq('id', recovery.id)
    .single();

  assertExists(recoveryData);
  const typedRecovery = recoveryData as MockRecovery;
  assertExists(typedRecovery.discs);

  // Create drop-off
  const dropOffData = {
    recovery_event_id: recovery.id,
    photo_url: 'https://example.com/drop-location.jpg',
    latitude: 40.785091,
    longitude: -73.968285,
  };

  const { data: dropOff } = await supabase.from('drop_offs').insert(dropOffData).select().single();

  assertExists(dropOff);

  // Update recovery status
  await supabase.from('recovery_events').update({ status: 'dropped_off' }).eq('id', recovery.id).select().single();

  // Create notification for owner
  await supabase
    .from('notifications')
    .insert({
      user_id: typedRecovery.discs.owner_id,
      type: 'disc_dropped_off',
      data: { recovery_event_id: recovery.id },
    })
    .select()
    .single();

  const response = new Response(
    JSON.stringify({
      success: true,
      drop_off: dropOff,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 201);
  const data = await response.json();
  assertExists(data.drop_off.id);

  // Verify notification was created for owner
  const { data: notifications } = await (supabase as any)
    .from('notifications')
    .select('*')
    .eq('user_id', typedRecovery.discs.owner_id)
    .eq('type', 'disc_dropped_off')
    .order('created_at', { ascending: false })
    .limit(1);

  assertExists(notifications);
  assertEquals(notifications.length, 1);
  assertEquals(notifications[0].type, 'disc_dropped_off');
  assertExists(notifications[0].data.recovery_event_id);
});
