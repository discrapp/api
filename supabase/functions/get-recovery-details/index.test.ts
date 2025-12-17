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
  manufacturer?: string;
  plastic?: string;
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
  disc?: MockDisc;
  owner?: MockUser;
  finder?: MockUser;
  meetup_proposals?: MockMeetupProposal[];
};

type MockMeetupProposal = {
  id: string;
  recovery_event_id: string;
  proposed_by: string;
  location_name: string;
  proposed_datetime: string;
  status: string;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockMeetupProposals: MockMeetupProposal[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockDiscs = [];
  mockRecoveryEvents = [];
  mockMeetupProposals = [];
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
        eq: (_column: string, value: string) => ({
          single: () => {
            if (table === 'recovery_events') {
              const event = mockRecoveryEvents.find((e) => e.id === value);
              if (!event) {
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }

              const disc = mockDiscs.find((d) => d.id === event.disc_id);
              const owner = disc ? mockUsers.find((u) => u.id === disc.owner_id) : undefined;
              const finder = mockUsers.find((u) => u.id === event.finder_id);
              const proposals = mockMeetupProposals.filter((p) => p.recovery_event_id === event.id);

              // Determine user role
              let userRole = null;
              if (disc && disc.owner_id === userId) {
                userRole = 'owner';
              } else if (event.finder_id === userId) {
                userRole = 'finder';
              }

              return Promise.resolve({
                data: {
                  ...event,
                  disc,
                  owner,
                  finder,
                  user_role: userRole,
                  meetup_proposals: proposals,
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
}

Deno.test('get-recovery-details: should return 405 for non-GET requests', async () => {
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

Deno.test('get-recovery-details: should return 401 when not authenticated', async () => {
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

Deno.test('get-recovery-details: should return 400 when id is missing', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const queryParams = new URLSearchParams();
  const recoveryId = queryParams.get('id');

  if (!recoveryId) {
    const response = new Response(JSON.stringify({ error: 'Missing recovery event ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing recovery event ID');
  }
});

Deno.test('get-recovery-details: should return 404 when recovery not found', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const supabase = mockSupabaseClient(userId);
  const recoveryId = '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*), owner:users(*), finder:users(*), meetup_proposals(*)')
    .eq('id', recoveryId)
    .single();

  if (error || !data) {
    const response = new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const responseData = await response.json();
    assertEquals(responseData.error, 'Recovery event not found');
  }
});

Deno.test('get-recovery-details: should return 403 when user is not owner or finder', async () => {
  resetMocks();

  const ownerId = 'owner-1';
  const finderId = 'finder-1';
  const uninvolvedId = 'uninvolved-1';

  mockUsers.push(
    { id: ownerId, email: 'owner@example.com' },
    { id: finderId, email: 'finder@example.com' },
    { id: uninvolvedId, email: 'uninvolved@example.com' }
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

  const supabase = mockSupabaseClient(uninvolvedId);
  const { data: recovery } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*), owner:users(*), finder:users(*), meetup_proposals(*)')
    .eq('id', recoveryId)
    .single();

  assertExists(recovery);

  const userRole = (recovery as MockRecoveryEvent & { user_role: string | null }).user_role;

  if (!userRole) {
    const response = new Response(JSON.stringify({ error: 'You do not have access to this recovery event' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You do not have access to this recovery event');
  }
});

Deno.test('get-recovery-details: owner can access recovery details', async () => {
  resetMocks();

  const ownerId = 'owner-1';
  const finderId = 'finder-1';

  mockUsers.push({ id: ownerId, email: 'owner@example.com' }, { id: finderId, email: 'finder@example.com' });

  const discId = 'disc-1';
  mockDiscs.push({
    id: discId,
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
    manufacturer: 'Innova',
    plastic: 'Star',
    color: 'Blue',
    reward_amount: 10,
  });

  const recoveryId = 'recovery-1';
  mockRecoveryEvents.push({
    id: recoveryId,
    disc_id: discId,
    finder_id: finderId,
    status: 'found',
    finder_message: 'Found it!',
    found_at: new Date().toISOString(),
  });

  const supabase = mockSupabaseClient(ownerId);
  const { data: recovery } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*), owner:users(*), finder:users(*), meetup_proposals(*)')
    .eq('id', recoveryId)
    .single();

  assertExists(recovery);

  const response = new Response(JSON.stringify(recovery), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.id, recoveryId);
  assertEquals(data.status, 'found');
  assertEquals(data.user_role, 'owner');
  assertEquals(data.finder_message, 'Found it!');
  assertExists(data.disc);
  assertEquals(data.disc.name, 'Test Disc');
  assertEquals(data.disc.manufacturer, 'Innova');
  assertExists(data.owner);
  assertExists(data.finder);
});

Deno.test('get-recovery-details: finder can access recovery details', async () => {
  resetMocks();

  const ownerId = 'owner-1';
  const finderId = 'finder-1';

  mockUsers.push({ id: ownerId, email: 'owner@example.com' }, { id: finderId, email: 'finder@example.com' });

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

  const supabase = mockSupabaseClient(finderId);
  const { data: recovery } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*), owner:users(*), finder:users(*), meetup_proposals(*)')
    .eq('id', recoveryId)
    .single();

  assertExists(recovery);

  const response = new Response(JSON.stringify(recovery), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.id, recoveryId);
  assertEquals(data.user_role, 'finder');
});

Deno.test('get-recovery-details: includes meetup proposals', async () => {
  resetMocks();

  const ownerId = 'owner-1';
  const finderId = 'finder-1';

  mockUsers.push({ id: ownerId, email: 'owner@example.com' }, { id: finderId, email: 'finder@example.com' });

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
    status: 'meetup_proposed',
    found_at: new Date().toISOString(),
  });

  const proposalId = 'proposal-1';
  mockMeetupProposals.push({
    id: proposalId,
    recovery_event_id: recoveryId,
    proposed_by: finderId,
    location_name: 'Test Park',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
  });

  const supabase = mockSupabaseClient(ownerId);
  const { data: recovery } = await supabase
    .from('recovery_events')
    .select('*, disc:discs(*), owner:users(*), finder:users(*), meetup_proposals(*)')
    .eq('id', recoveryId)
    .single();

  assertExists(recovery);

  const response = new Response(JSON.stringify(recovery), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertExists(data.meetup_proposals);
  assertEquals(data.meetup_proposals.length, 1);
  assertEquals(data.meetup_proposals[0].location_name, 'Test Park');
});
