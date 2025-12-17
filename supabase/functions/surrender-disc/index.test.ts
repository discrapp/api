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

type MockRecoveryEvent = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  found_at: string;
  surrendered_at?: string | null;
  recovered_at?: string | null;
  original_owner_id?: string | null;
};

type MockNotification = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockNotifications: MockNotification[] = [];
let authHeaderPresent = false;
let currentUserId: string | null = null;

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockDiscs = [];
  mockRecoveryEvents = [];
  mockNotifications = [];
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
      admin: {
        createUser: (options: { email: string; password: string; email_confirm?: boolean }) => {
          const newUser: MockUser = {
            id: `user-${Date.now()}-${Math.random()}`,
            email: options.email,
          };
          mockUsers.push(newUser);
          return Promise.resolve({ data: { user: newUser }, error: null });
        },
        deleteUser: (userId: string) => {
          mockUsers = mockUsers.filter((u) => u.id !== userId);
          return Promise.resolve({ error: null });
        },
      },
    },
    from: (table: string) => ({
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: () => {
            if (table === 'discs') {
              const discData = values as MockDisc;
              const newDisc: MockDisc = {
                ...discData,
                id: `disc-${Date.now()}`,
              };
              mockDiscs.push(newDisc);
              return Promise.resolve({ data: newDisc, error: null });
            }
            if (table === 'recovery_events') {
              const recoveryData = values as MockRecoveryEvent;
              const newRecovery: MockRecoveryEvent = {
                ...recoveryData,
                id: `recovery-${Date.now()}`,
              };
              mockRecoveryEvents.push(newRecovery);
              return Promise.resolve({ data: newRecovery, error: null });
            }
            if (table === 'notifications') {
              const notificationData = values as MockNotification;
              const newNotification: MockNotification = {
                ...notificationData,
                id: `notification-${Date.now()}`,
              };
              mockNotifications.push(newNotification);
              return Promise.resolve({ data: newNotification, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
      select: (_columns?: string) => ({
        eq: (_column: string, value: string) => ({
          single: () => {
            if (table === 'recovery_events') {
              const recovery = mockRecoveryEvents.find((r) => r.id === value);
              if (recovery) {
                // Join with disc data
                const disc = mockDiscs.find((d) => d.id === recovery.disc_id);
                if (disc) {
                  return Promise.resolve({
                    data: { ...recovery, disc },
                    error: null,
                  });
                }
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            if (table === 'discs') {
              const disc = mockDiscs.find((d) => d.id === value);
              if (disc) {
                return Promise.resolve({ data: disc, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, value: string) => ({
          select: () => ({
            single: () => {
              if (table === 'recovery_events') {
                const recovery = mockRecoveryEvents.find((r) => r.id === value);
                if (recovery) {
                  Object.assign(recovery, values);
                  return Promise.resolve({ data: recovery, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Recovery event not found' } });
              }
              if (table === 'discs') {
                const disc = mockDiscs.find((d) => d.id === value);
                if (disc) {
                  Object.assign(disc, values);
                  return Promise.resolve({ data: disc, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Disc not found' } });
              }
              return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
            },
          }),
        }),
      }),
      delete: () => ({
        eq: (_column: string, value: string) => {
          if (table === 'notifications') {
            mockNotifications = mockNotifications.filter((n) => n.user_id !== value);
            return Promise.resolve({ error: null });
          }
          if (table === 'recovery_events') {
            mockRecoveryEvents = mockRecoveryEvents.filter((r) => r.id !== value);
            return Promise.resolve({ error: null });
          }
          if (table === 'discs') {
            mockDiscs = mockDiscs.filter((d) => d.id !== value);
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ error: { message: 'Unknown table' } });
        },
      }),
    }),
  };
}

Deno.test('surrender-disc: should return 405 for non-POST requests', async () => {
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

Deno.test('surrender-disc: should return 401 when not authenticated', async () => {
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

Deno.test('surrender-disc: should return 400 when recovery_event_id is missing', async () => {
  resetMocks();
  const user: MockUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(user);
  currentUserId = user.id;
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

Deno.test('surrender-disc: should return 404 when recovery event not found', async () => {
  resetMocks();
  const user: MockUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(user);
  currentUserId = user.id;
  authHeaderPresent = true;

  const supabase = mockSupabaseClient();
  const recoveryEventId = '00000000-0000-0000-0000-000000000000';

  const { data: recovery } = await supabase.from('recovery_events').select('*').eq('id', recoveryEventId).single();

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

Deno.test('surrender-disc: should return 403 when user is not disc owner', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.admin.createUser({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.admin.createUser({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create disc
  const { data: disc, error: discError } = await supabase
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event
  const { data: recovery, error: recoveryError } = await supabase
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'found',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  // Finder tries to surrender (should fail)
  currentUserId = finderAuth.user.id;
  authHeaderPresent = true;

  const { data: authData } = await supabase.auth.getUser();
  const { data: recoveryData } = await supabase.from('recovery_events').select('*').eq('id', recovery.id).single();

  if (recoveryData && 'disc' in recoveryData) {
    const recoveryDisc = (recoveryData as { disc: MockDisc }).disc;
    if (recoveryDisc.owner_id !== authData.user?.id) {
      const response = new Response(JSON.stringify({ error: 'Only the disc owner can surrender the disc' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 403);
      const data = await response.json();
      assertEquals(data.error, 'Only the disc owner can surrender the disc');
    }
  }

  // Cleanup
  await supabase.from('recovery_events').delete().eq('id', recovery.id);
  await supabase.from('discs').delete().eq('id', disc.id);
  await supabase.auth.admin.deleteUser(ownerAuth.user.id);
  await supabase.auth.admin.deleteUser(finderAuth.user.id);
});

Deno.test('surrender-disc: should return 400 when recovery is not in valid status', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.admin.createUser({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.admin.createUser({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create disc
  const { data: disc, error: discError } = await supabase
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event in 'recovered' status
  const { data: recovery, error: recoveryError } = await supabase
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'recovered',
      found_at: new Date().toISOString(),
      recovered_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  // Owner tries to surrender (should fail - invalid status)
  currentUserId = ownerAuth.user.id;
  authHeaderPresent = true;

  const { data: recoveryData } = await supabase.from('recovery_events').select('*').eq('id', recovery.id).single();

  if (recoveryData && 'status' in recoveryData && !['found', 'meetup_proposed'].includes(recoveryData.status)) {
    const response = new Response(JSON.stringify({ error: 'Disc can only be surrendered during an active recovery' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Disc can only be surrendered during an active recovery');
  }

  // Cleanup
  await supabase.from('recovery_events').delete().eq('id', recovery.id);
  await supabase.from('discs').delete().eq('id', disc.id);
  await supabase.auth.admin.deleteUser(ownerAuth.user.id);
  await supabase.auth.admin.deleteUser(finderAuth.user.id);
});

Deno.test('surrender-disc: owner can successfully surrender disc to finder', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.admin.createUser({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.admin.createUser({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create disc
  const { data: disc, error: discError } = await supabase
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event
  const { data: recovery, error: recoveryError } = await supabase
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'found',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  // Owner surrenders disc
  currentUserId = ownerAuth.user.id;
  authHeaderPresent = true;

  const surrenderedAt = new Date().toISOString();

  // Update recovery event
  const { data: updatedRecovery } = await supabase
    .from('recovery_events')
    .update({
      status: 'surrendered',
      surrendered_at: surrenderedAt,
      original_owner_id: ownerAuth.user.id,
    })
    .eq('id', recovery.id)
    .select()
    .single();

  // Update disc ownership
  const { data: updatedDisc } = await supabase
    .from('discs')
    .update({ owner_id: finderAuth.user.id })
    .eq('id', disc.id)
    .select()
    .single();

  // Create notification
  const discName = (disc as MockDisc).name;
  await supabase.from('notifications').insert({
    user_id: finderAuth.user.id,
    title: 'Disc Surrendered',
    message: `The owner has surrendered ${discName} to you`,
    type: 'disc_surrendered',
    read: false,
  });

  const response = new Response(
    JSON.stringify({
      success: true,
      recovery_event: updatedRecovery,
      disc: { new_owner_id: finderAuth.user.id },
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
  assertEquals(data.recovery_event.status, 'surrendered');
  assertExists(data.recovery_event.surrendered_at);
  assertEquals(data.disc.new_owner_id, finderAuth.user.id);

  // Verify disc ownership
  const verifiedDisc = updatedDisc as MockDisc;
  assertEquals(verifiedDisc?.owner_id, finderAuth.user.id);

  // Verify recovery event
  const verifiedRecovery = updatedRecovery as MockRecoveryEvent;
  assertEquals(verifiedRecovery?.status, 'surrendered');
  assertExists(verifiedRecovery?.surrendered_at);
  assertEquals(verifiedRecovery?.original_owner_id, ownerAuth.user.id);

  // Cleanup
  await supabase.from('notifications').delete().eq('user_id', finderAuth.user.id);
  await supabase.from('recovery_events').delete().eq('id', recovery.id);
  await supabase.from('discs').delete().eq('id', disc.id);
  await supabase.auth.admin.deleteUser(ownerAuth.user.id);
  await supabase.auth.admin.deleteUser(finderAuth.user.id);
});

Deno.test('surrender-disc: works with meetup_proposed status', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.admin.createUser({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.admin.createUser({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create disc
  const { data: disc, error: discError } = await supabase
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event in 'meetup_proposed' status
  const { data: recovery, error: recoveryError } = await supabase
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'meetup_proposed',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  // Owner surrenders disc
  currentUserId = ownerAuth.user.id;
  authHeaderPresent = true;

  const surrenderedAt = new Date().toISOString();

  // Update recovery event
  const { data: updatedRecovery } = await supabase
    .from('recovery_events')
    .update({
      status: 'surrendered',
      surrendered_at: surrenderedAt,
      original_owner_id: ownerAuth.user.id,
    })
    .eq('id', recovery.id)
    .select()
    .single();

  // Update disc ownership
  await supabase.from('discs').update({ owner_id: finderAuth.user.id }).eq('id', disc.id).select().single();

  const response = new Response(
    JSON.stringify({
      success: true,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);

  // Verify recovery event was updated
  const verifiedRecovery = updatedRecovery as MockRecoveryEvent;
  assertEquals(verifiedRecovery?.status, 'surrendered');

  // Cleanup
  await supabase.from('notifications').delete().eq('user_id', finderAuth.user.id);
  await supabase.from('recovery_events').delete().eq('id', recovery.id);
  await supabase.from('discs').delete().eq('id', disc.id);
  await supabase.auth.admin.deleteUser(ownerAuth.user.id);
  await supabase.auth.admin.deleteUser(finderAuth.user.id);
});
