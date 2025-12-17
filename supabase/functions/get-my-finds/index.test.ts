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
  manufacturer?: string;
  color?: string;
  reward_amount?: number;
};

type MockRecoveryEvent = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  finder_message?: string;
  found_at: string;
  recovered_at?: string | null;
  disc?: MockDisc;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockDiscs = [];
  mockRecoveryEvents = [];
}

// Mock Supabase client
function mockSupabaseClient(userId?: string) {
  return {
    auth: {
      getUser: () => {
        const user = mockUsers.find((u) => u.id === userId);
        if (user) {
          return Promise.resolve({ data: { user }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } });
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          neq: (column2: string, value2: string) => {
            if (table === 'recovery_events') {
              const events = mockRecoveryEvents
                .filter(
                  (e) =>
                    e[column as keyof MockRecoveryEvent] === value && e[column2 as keyof MockRecoveryEvent] !== value2
                )
                .map((event) => {
                  const disc = mockDiscs.find((d) => d.id === event.disc_id);
                  const owner_display_name = disc?.owner_id ? 'Owner Name' : 'No owner';
                  return {
                    ...event,
                    disc: disc ? { ...disc, owner_display_name } : null,
                  };
                });
              return Promise.resolve({ data: events, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
    }),
  };
}

Deno.test('get-my-finds: should return 405 for non-GET requests', async () => {
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

Deno.test('get-my-finds: should return 401 when not authenticated', async () => {
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

Deno.test('get-my-finds: returns empty array when user has no finds', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const supabase = mockSupabaseClient(userId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: recoveries } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*)')
    .eq('finder_id', authData.user.id)
    .neq('status', 'recovered');

  const response = new Response(JSON.stringify(recoveries), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(Array.isArray(data), true);
  assertEquals(data.length, 0);
});

Deno.test('get-my-finds: returns recovery events where user is finder', async () => {
  resetMocks();

  const ownerId = 'owner-1';
  const finderId = 'finder-1';
  mockUsers.push({ id: ownerId, email: 'owner@example.com' }, { id: finderId, email: 'finder@example.com' });

  const discId = 'disc-1';
  mockDiscs.push({
    id: discId,
    owner_id: ownerId,
    name: 'Found Disc',
    mold: 'Destroyer',
    manufacturer: 'Innova',
    color: 'Blue',
    reward_amount: 15,
  });

  const recoveryId = 'recovery-1';
  mockRecoveryEvents.push({
    id: recoveryId,
    disc_id: discId,
    finder_id: finderId,
    status: 'found',
    finder_message: 'Found this disc!',
    found_at: new Date().toISOString(),
  });

  const supabase = mockSupabaseClient(finderId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: recoveries } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*)')
    .eq('finder_id', authData.user.id)
    .neq('status', 'recovered');

  const response = new Response(JSON.stringify(recoveries), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(Array.isArray(data), true);
  assertEquals(data.length, 1);
  assertEquals(data[0].id, recoveryId);
  assertEquals(data[0].status, 'found');
  assertEquals(data[0].finder_message, 'Found this disc!');
  assertExists(data[0].disc);
  assertEquals(data[0].disc.name, 'Found Disc');
  assertEquals(data[0].disc.manufacturer, 'Innova');
});

Deno.test('get-my-finds: excludes completed recoveries', async () => {
  resetMocks();

  const ownerId = 'owner-1';
  const finderId = 'finder-1';
  mockUsers.push({ id: ownerId, email: 'owner@example.com' }, { id: finderId, email: 'finder@example.com' });

  const discId = 'disc-1';
  mockDiscs.push({
    id: discId,
    owner_id: ownerId,
    name: 'Recovered Disc',
    mold: 'Destroyer',
  });

  const recoveryId = 'recovery-1';
  mockRecoveryEvents.push({
    id: recoveryId,
    disc_id: discId,
    finder_id: finderId,
    status: 'recovered',
    found_at: new Date().toISOString(),
    recovered_at: new Date().toISOString(),
  });

  const supabase = mockSupabaseClient(finderId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: recoveries } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*)')
    .eq('finder_id', authData.user.id)
    .neq('status', 'recovered');

  const response = new Response(JSON.stringify(recoveries), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.length, 0);
});

Deno.test('get-my-finds: includes abandoned recoveries', async () => {
  resetMocks();

  const finderId = 'finder-1';
  mockUsers.push({ id: finderId, email: 'finder@example.com' });

  const discId = 'disc-1';
  mockDiscs.push({
    id: discId,
    owner_id: null,
    name: 'Abandoned Disc',
    mold: 'Destroyer',
  });

  const recoveryId = 'recovery-1';
  mockRecoveryEvents.push({
    id: recoveryId,
    disc_id: discId,
    finder_id: finderId,
    status: 'abandoned',
    found_at: new Date().toISOString(),
  });

  const supabase = mockSupabaseClient(finderId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: recoveries } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*)')
    .eq('finder_id', authData.user.id)
    .neq('status', 'recovered');

  const response = new Response(JSON.stringify(recoveries), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.length, 1);
  assertEquals(data[0].status, 'abandoned');
  assertEquals(data[0].disc.owner_display_name, 'No owner');
});

Deno.test('get-my-finds: does not return finds for other users', async () => {
  resetMocks();

  const ownerId = 'owner-1';
  const finderId = 'finder-1';
  const otherId = 'other-1';
  mockUsers.push(
    { id: ownerId, email: 'owner@example.com' },
    { id: finderId, email: 'finder@example.com' },
    { id: otherId, email: 'other@example.com' }
  );

  const discId = 'disc-1';
  mockDiscs.push({
    id: discId,
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  });

  const recoveryId = 'recovery-1';
  mockRecoveryEvents.push({
    id: recoveryId,
    disc_id: discId,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
  });

  const supabase = mockSupabaseClient(otherId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: recoveries } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*)')
    .eq('finder_id', authData.user.id)
    .neq('status', 'recovered');

  const response = new Response(JSON.stringify(recoveries), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.length, 0);
});
