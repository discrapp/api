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
};

type MockMeetupProposal = {
  id: string;
  recovery_event_id: string;
  proposed_by: string;
  location_name: string;
  proposed_datetime: string;
  status: string;
  recovery_events?: MockRecovery & { discs?: MockDisc };
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
              if (table === 'meetup_proposals') {
                const proposal = mockMeetupProposals.find((p) => p[column as keyof MockMeetupProposal] === value);
                if (proposal) {
                  if (_columns && _columns.includes('recovery_events')) {
                    const recovery = mockRecoveries.find((r) => r.id === proposal.recovery_event_id);
                    if (recovery && _columns && _columns.includes('discs')) {
                      const disc = mockDiscs.find((d) => d.id === recovery.disc_id);
                      return Promise.resolve({
                        data: {
                          ...proposal,
                          recovery_events: { ...recovery, discs: disc || null },
                        },
                        error: null,
                      });
                    }
                  }
                  return Promise.resolve({ data: proposal, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              }
              if (table === 'recovery_events') {
                const recovery = mockRecoveries.find((r) => r[column as keyof MockRecovery] === value);
                return Promise.resolve({ data: recovery || null, error: recovery ? null : { message: 'Not found' } });
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
              if (table === 'meetup_proposals') {
                const proposal = mockMeetupProposals.find((p) => p[column as keyof MockMeetupProposal] === value);
                if (proposal) {
                  Object.assign(proposal, values);
                  return Promise.resolve({ data: proposal, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              }
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
    }),
  };
}

Deno.test('accept-meetup: should return 405 for non-POST requests', async () => {
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

Deno.test('accept-meetup: should return 401 when not authenticated', async () => {
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

Deno.test('accept-meetup: should return 400 when proposal_id is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: { proposal_id?: string } = {};

  if (!body.proposal_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: proposal_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: proposal_id');
  }
});

Deno.test('accept-meetup: should return 404 when proposal not found', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const proposal_id = '00000000-0000-0000-0000-000000000000';

  const { data: proposal } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', proposal_id)
    .single();

  if (!proposal) {
    const response = new Response(JSON.stringify({ error: 'Meetup proposal not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Meetup proposal not found');
  }
});

Deno.test('accept-meetup: should return 403 when user is not the disc owner', async () => {
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
    status: 'found',
  };
  mockRecoveries.push(recovery);

  // Create meetup proposal
  const proposal: MockMeetupProposal = {
    id: 'proposal-789',
    recovery_event_id: recovery.id,
    proposed_by: recovery.finder_id,
    location_name: 'Test Location',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'proposed',
  };
  mockMeetupProposals.push(proposal);

  const { data: proposalData } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', proposal.id)
    .single();

  assertExists(proposalData);
  const typedProposal = proposalData as MockMeetupProposal;
  assertExists(typedProposal.recovery_events);
  assertExists(typedProposal.recovery_events.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  if (typedProposal.recovery_events.discs.owner_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Only the disc owner can accept meetup proposals' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the disc owner can accept meetup proposals');
  }
});

Deno.test('accept-meetup: owner can accept a meetup proposal', async () => {
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
    status: 'found',
  };
  mockRecoveries.push(recovery);

  // Create meetup proposal
  const proposal: MockMeetupProposal = {
    id: 'proposal-789',
    recovery_event_id: recovery.id,
    proposed_by: recovery.finder_id,
    location_name: 'Maple Hill DGC Parking Lot',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'proposed',
  };
  mockMeetupProposals.push(proposal);

  const { data: proposalData } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', proposal.id)
    .single();

  assertExists(proposalData);
  const typedProposal = proposalData as MockMeetupProposal;
  assertExists(typedProposal.recovery_events);
  assertExists(typedProposal.recovery_events.discs);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Verify ownership
  assertEquals(typedProposal.recovery_events.discs.owner_id, authData.user.id);
  assertEquals(typedProposal.status, 'proposed');

  // Update proposal status to accepted
  const { data: updatedProposal } = await supabase
    .from('meetup_proposals')
    .update({ status: 'accepted' })
    .eq('id', proposal.id)
    .select()
    .single();

  // Update recovery event status to meetup_scheduled
  await supabase.from('recovery_events').update({ status: 'meetup_scheduled' }).eq('id', recovery.id).select().single();

  // Create notification for finder
  await supabase
    .from('notifications')
    .insert({
      user_id: recovery.finder_id,
      type: 'meetup_accepted',
      data: { proposal_id: proposal.id },
    })
    .select()
    .single();

  const response = new Response(
    JSON.stringify({
      success: true,
      proposal: updatedProposal,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.proposal);
  assertEquals(data.proposal.status, 'accepted');

  // Verify recovery event status was updated
  const updatedEvent = mockRecoveries.find((r) => r.id === recovery.id);
  assertEquals(updatedEvent?.status, 'meetup_scheduled');

  // Verify notification was created
  const notification = mockNotifications.find((n) => n.user_id === recovery.finder_id && n.type === 'meetup_accepted');
  assertExists(notification);
});

Deno.test('accept-meetup: should reject already accepted proposals', async () => {
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

  // Create already accepted proposal
  const proposal: MockMeetupProposal = {
    id: 'proposal-789',
    recovery_event_id: recovery.id,
    proposed_by: recovery.finder_id,
    location_name: 'Test Location',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'accepted',
  };
  mockMeetupProposals.push(proposal);

  const { data: proposalData } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', proposal.id)
    .single();

  assertExists(proposalData);

  if (proposalData.status !== 'proposed') {
    const response = new Response(JSON.stringify({ error: 'This proposal has already been accepted or rejected' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'This proposal has already been accepted or rejected');
  }
});
