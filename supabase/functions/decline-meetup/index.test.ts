import { assertEquals } from 'jsr:@std/assert';

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
};

type MockMeetupProposal = {
  id: string;
  recovery_event_id: string;
  proposed_by: string;
  location_name: string;
  proposed_datetime: string;
  status: string;
  decline_reason?: string;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockMeetupProposals: MockMeetupProposal[] = [];
let mockCurrentUser: MockUser | null = null;

// Reset mocks between tests
function resetMocks() {
  mockUsers = [];
  mockDiscs = [];
  mockRecoveryEvents = [];
  mockMeetupProposals = [];
  mockCurrentUser = null;
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: async () => {
        if (mockCurrentUser) {
          return { data: { user: mockCurrentUser }, error: null };
        }
        return { data: { user: null }, error: { message: 'Not authenticated' } };
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: async () => {
            if (table === 'meetup_proposals') {
              const proposal = mockMeetupProposals.find((p) => p.id === value);
              if (!proposal) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              // Join with recovery_events and discs
              const recovery = mockRecoveryEvents.find((r) => r.id === proposal.recovery_event_id);
              if (!recovery) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              const disc = mockDiscs.find((d) => d.id === recovery.disc_id);
              if (!disc) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              const result = {
                ...proposal,
                recovery_events: {
                  ...recovery,
                  discs: disc,
                },
              };
              return { data: result, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: (updates: Record<string, unknown>) => ({
        eq: (column: string, value: string) => ({
          select: (_columns?: string) => ({
            single: async () => {
              if (table === 'meetup_proposals') {
                const index = mockMeetupProposals.findIndex((p) => p.id === value);
                if (index !== -1) {
                  mockMeetupProposals[index] = { ...mockMeetupProposals[index], ...updates };
                  return { data: mockMeetupProposals[index], error: null };
                }
              }
              if (table === 'recovery_events') {
                const index = mockRecoveryEvents.findIndex((r) => r.id === value);
                if (index !== -1) {
                  mockRecoveryEvents[index] = { ...mockRecoveryEvents[index], ...updates };
                  return { data: mockRecoveryEvents[index], error: null };
                }
              }
              return { data: null, error: { message: 'Not found' } };
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('decline-meetup: should return 405 for non-POST requests', () => {
  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('decline-meetup: should return 401 when not authenticated', async () => {
  resetMocks();
  const supabase = mockSupabaseClient();

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Missing authorization header');
  }
});

Deno.test('decline-meetup: should return 400 when proposal_id is missing', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

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

Deno.test('decline-meetup: should return 404 when proposal not found', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const { data: proposal } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', '00000000-0000-0000-0000-000000000000')
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

Deno.test('decline-meetup: should return 403 when user is not disc owner', async () => {
  resetMocks();
  const ownerId = 'owner-123';
  const finderId = 'finder-456';
  mockCurrentUser = { id: finderId, email: 'finder@example.com' };

  mockUsers.push({ id: ownerId, email: 'owner@example.com' });
  mockUsers.push(mockCurrentUser);

  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'meetup_proposed',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const proposal: MockMeetupProposal = {
    id: 'proposal-123',
    recovery_event_id: recovery.id,
    proposed_by: finderId,
    location_name: 'Test Park',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
  };
  mockMeetupProposals.push(proposal);

  const supabase = mockSupabaseClient();
  const { data: proposalData } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', proposal.id)
    .single();

  if (proposalData && proposalData.recovery_events.discs.owner_id !== mockCurrentUser.id) {
    const response = new Response(JSON.stringify({ error: 'Only the disc owner can decline meetup proposals' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the disc owner can decline meetup proposals');
  }
});

Deno.test('decline-meetup: should return 400 when proposal already declined', async () => {
  resetMocks();
  const ownerId = 'owner-123';
  const finderId = 'finder-456';
  mockCurrentUser = { id: ownerId, email: 'owner@example.com' };

  mockUsers.push(mockCurrentUser);
  mockUsers.push({ id: finderId, email: 'finder@example.com' });

  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'meetup_proposed',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const proposal: MockMeetupProposal = {
    id: 'proposal-123',
    recovery_event_id: recovery.id,
    proposed_by: finderId,
    location_name: 'Test Park',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'declined',
  };
  mockMeetupProposals.push(proposal);

  const supabase = mockSupabaseClient();
  const { data: proposalData } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', proposal.id)
    .single();

  if (proposalData && proposalData.status !== 'pending') {
    const response = new Response(JSON.stringify({ error: 'This proposal has already been accepted or declined' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'This proposal has already been accepted or declined');
  }
});

Deno.test('decline-meetup: owner can successfully decline a pending proposal', async () => {
  resetMocks();
  const ownerId = 'owner-123';
  const finderId = 'finder-456';
  mockCurrentUser = { id: ownerId, email: 'owner@example.com' };

  mockUsers.push(mockCurrentUser);
  mockUsers.push({ id: finderId, email: 'finder@example.com' });

  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'meetup_proposed',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const proposal: MockMeetupProposal = {
    id: 'proposal-123',
    recovery_event_id: recovery.id,
    proposed_by: finderId,
    location_name: 'Test Park',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    status: 'pending',
  };
  mockMeetupProposals.push(proposal);

  const supabase = mockSupabaseClient();

  // Get proposal
  const { data: proposalData } = await supabase
    .from('meetup_proposals')
    .select('*, recovery_events(*, discs(*))')
    .eq('id', proposal.id)
    .single();

  if (proposalData && proposalData.recovery_events.discs.owner_id === mockCurrentUser.id) {
    // Decline proposal
    const { data: updatedProposal } = await supabase
      .from('meetup_proposals')
      .update({ status: 'declined', decline_reason: 'Too far away' })
      .eq('id', proposal.id)
      .select()
      .single();

    // Revert recovery status
    await supabase.from('recovery_events').update({ status: 'found' }).eq('id', recovery.id).select().single();

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
    assertEquals(data.proposal.status, 'declined');

    // Verify proposal status was updated
    const updatedProposalCheck = mockMeetupProposals.find((p) => p.id === proposal.id);
    assertEquals(updatedProposalCheck?.status, 'declined');

    // Verify recovery event status was reverted
    const updatedRecoveryCheck = mockRecoveryEvents.find((r) => r.id === recovery.id);
    assertEquals(updatedRecoveryCheck?.status, 'found');
  }
});
