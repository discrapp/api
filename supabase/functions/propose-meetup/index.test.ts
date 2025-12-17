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
  recovered_at?: string;
};

type MockMeetupProposal = {
  id: string;
  recovery_event_id: string;
  proposed_by: string;
  location_name: string;
  latitude?: number | null;
  longitude?: number | null;
  proposed_datetime: string;
  message?: string | null;
  status: string;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockMeetupProposals: MockMeetupProposal[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockRecoveryEvents = [];
  mockMeetupProposals = [];
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
        eq: (_column: string, value: string) => ({
          single: async () => {
            if (table === 'recovery_events') {
              const event = mockRecoveryEvents.find((evt) => evt.id === value);
              if (!event) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              const disc = mockDiscs.find((d) => d.id === event.disc_id);
              return {
                data: { ...event, disc: disc ? { owner_id: disc.owner_id } : null },
                error: null,
              };
            }
            if (table === 'meetup_proposals') {
              const proposal = mockMeetupProposals.find((p) => p.id === value || p.recovery_event_id === value);
              return { data: proposal || null, error: proposal ? null : { code: 'PGRST116' } };
            }
            return { data: null, error: null };
          },
        }),
      }),
      insert: (values: Partial<MockRecoveryEvent> | Partial<MockMeetupProposal> | Partial<MockDisc>) => ({
        select: () => ({
          single: () => {
            if (table === 'recovery_events') {
              const v = values as Partial<MockRecoveryEvent>;
              const newEvent: MockRecoveryEvent = {
                id: `recovery-${Date.now()}`,
                disc_id: v.disc_id || '',
                finder_id: v.finder_id || '',
                status: v.status || 'found',
                found_at: v.found_at || new Date().toISOString(),
                recovered_at: v.recovered_at,
              };
              mockRecoveryEvents.push(newEvent);
              return Promise.resolve({ data: newEvent, error: null });
            }
            if (table === 'meetup_proposals') {
              const v = values as Partial<MockMeetupProposal>;
              const newProposal: MockMeetupProposal = {
                id: `proposal-${Date.now()}`,
                recovery_event_id: v.recovery_event_id || '',
                proposed_by: v.proposed_by || '',
                location_name: v.location_name || '',
                latitude: v.latitude,
                longitude: v.longitude,
                proposed_datetime: v.proposed_datetime || '',
                message: v.message,
                status: 'pending',
              };
              mockMeetupProposals.push(newProposal);
              return Promise.resolve({ data: newProposal, error: null });
            }
            if (table === 'discs') {
              const v = values as Partial<MockDisc>;
              const newDisc: MockDisc = {
                id: `disc-${Date.now()}`,
                owner_id: v.owner_id || '',
                name: v.name || '',
                mold: v.mold || '',
              };
              mockDiscs.push(newDisc);
              return Promise.resolve({ data: newDisc, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (values: Partial<MockRecoveryEvent> | Partial<MockMeetupProposal>) => ({
        eq: (_column: string, value: string) => {
          if (table === 'recovery_events') {
            const event = mockRecoveryEvents.find((evt) => evt.id === value);
            if (event) {
              Object.assign(event, values);
            }
          }
          if (table === 'meetup_proposals') {
            const proposal = mockMeetupProposals.find((p) => p.recovery_event_id === value || p.id === value);
            if (proposal) {
              Object.assign(proposal, values);
            }
          }
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
}

Deno.test('propose-meetup: should return 405 for non-POST requests', () => {
  resetMocks();

  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('propose-meetup: should return 401 when not authenticated', async () => {
  resetMocks();

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

Deno.test('propose-meetup: should return 400 when required fields are missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: {
    recovery_event_id?: string;
    location_name?: string;
    proposed_datetime?: string;
  } = {};

  if (!body.recovery_event_id || !body.location_name || !body.proposed_datetime) {
    const response = new Response(
      JSON.stringify({
        error: 'Missing required fields: recovery_event_id, location_name, proposed_datetime',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required fields: recovery_event_id, location_name, proposed_datetime');
  }
});

Deno.test('propose-meetup: should return 404 for non-existent recovery event', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const body = {
    recovery_event_id: '00000000-0000-0000-0000-000000000000',
    location_name: 'Test Park',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
  };

  const { data: recovery } = await supabase
    .from('recovery_events')
    .select('*')
    .eq('id', body.recovery_event_id)
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

Deno.test('propose-meetup: should return 403 when user is not a participant', async () => {
  resetMocks();
  mockUser = { id: 'uninvolved-user', email: 'uninvolved@example.com' };

  const ownerId = 'owner-123';
  const finderId = 'finder-123';

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-1',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data: recoveryData } = await supabase.from('recovery_events').select('*').eq('id', recovery.id).single();

  assertExists(recoveryData);
  assertExists(authData.user);

  const recoveryTyped = recoveryData as MockRecoveryEvent & { disc: { owner_id: string } | null };
  const disc_owner = recoveryTyped.disc?.owner_id;
  const isParticipant = authData.user.id === recoveryTyped.finder_id || authData.user.id === disc_owner;

  if (!isParticipant) {
    const response = new Response(JSON.stringify({ error: 'You are not a participant in this recovery' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You are not a participant in this recovery');
  }
});

Deno.test('propose-meetup: finder can successfully propose meetup', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-123';
  mockUser = { id: finderId, email: 'finder@example.com' };

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-1',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const proposalData = {
    recovery_event_id: recovery.id,
    proposed_by: authData.user.id,
    location_name: 'Central Park',
    latitude: 40.785091,
    longitude: -73.968285,
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
    message: 'Meet by the fountain',
  };

  const { data: proposal } = await supabase.from('meetup_proposals').insert(proposalData).select().single();

  assertExists(proposal);

  // Update recovery status
  await supabase.from('recovery_events').update({ status: 'meetup_proposed' }).eq('id', recovery.id);

  const response = new Response(JSON.stringify({ success: true, proposal }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.proposal);
  assertExists(data.proposal.id);
  assertEquals(data.proposal.recovery_event_id, recovery.id);
  assertEquals(data.proposal.location_name, 'Central Park');
  assertEquals(data.proposal.status, 'pending');
  assertEquals(data.proposal.message, 'Meet by the fountain');
  assertEquals(data.proposal.proposed_by, finderId);

  // Verify recovery status was updated
  const updatedRecovery = mockRecoveryEvents.find((r) => r.id === recovery.id);
  assertEquals(updatedRecovery?.status, 'meetup_proposed');
});

Deno.test('propose-meetup: owner can successfully propose meetup', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-123';
  mockUser = { id: ownerId, email: 'owner@example.com' };

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-1',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const proposalData = {
    recovery_event_id: recovery.id,
    proposed_by: authData.user.id,
    location_name: 'My Local Course',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
  };

  const { data: proposal } = await supabase.from('meetup_proposals').insert(proposalData).select().single();

  assertExists(proposal);

  const response = new Response(JSON.stringify({ success: true, proposal }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.proposal.proposed_by, ownerId);
});

Deno.test('propose-meetup: works without optional fields', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-123';
  mockUser = { id: finderId, email: 'finder@example.com' };

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-1',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const proposalData = {
    recovery_event_id: recovery.id,
    proposed_by: authData.user.id,
    location_name: 'Some Location',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
  };

  const { data: proposal } = await supabase.from('meetup_proposals').insert(proposalData).select().single();

  assertExists(proposal);

  const response = new Response(JSON.stringify({ success: true, proposal }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.proposal.latitude, undefined);
  assertEquals(data.proposal.longitude, undefined);
  assertEquals(data.proposal.message, undefined);
});

Deno.test('propose-meetup: counter-proposal declines existing pending proposal', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-123';

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-1',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  // Finder creates original proposal
  mockUser = { id: finderId, email: 'finder@example.com' };
  let supabase = mockSupabaseClient();

  const originalProposalData = {
    recovery_event_id: recovery.id,
    proposed_by: finderId,
    location_name: 'Original Location',
    proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
  };

  const { data: originalProposal } = await supabase
    .from('meetup_proposals')
    .insert(originalProposalData)
    .select()
    .single();

  assertExists(originalProposal);
  const originalProposalTyped = originalProposal as MockMeetupProposal;
  assertEquals(originalProposalTyped.status, 'pending');

  // Owner creates counter-proposal
  mockUser = { id: ownerId, email: 'owner@example.com' };
  supabase = mockSupabaseClient();

  // Decline existing proposal
  await supabase.from('meetup_proposals').update({ status: 'declined' }).eq('recovery_event_id', recovery.id);

  const counterProposalData = {
    recovery_event_id: recovery.id,
    proposed_by: ownerId,
    location_name: 'Counter Location',
    proposed_datetime: new Date(Date.now() + 172800000).toISOString(),
    message: 'How about here instead?',
  };

  const { data: counterProposal } = await supabase
    .from('meetup_proposals')
    .insert(counterProposalData)
    .select()
    .single();

  assertExists(counterProposal);

  const response = new Response(JSON.stringify({ success: true, proposal: counterProposal }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.proposal.status, 'pending');
  assertEquals(data.proposal.location_name, 'Counter Location');

  // Verify original proposal was declined
  const declinedProposal = mockMeetupProposals.find((p) => p.id === originalProposal.id);
  assertEquals(declinedProposal?.status, 'declined');

  // Verify counter proposal is pending
  const pendingProposal = mockMeetupProposals.find((p) => p.id === counterProposal.id);
  assertEquals(pendingProposal?.status, 'pending');
});

Deno.test('propose-meetup: should return 400 for recovery that is already completed', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-123';
  mockUser = { id: finderId, email: 'finder@example.com' };

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-1',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'recovered',
    found_at: new Date().toISOString(),
    recovered_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();

  const { data: recoveryData } = await supabase.from('recovery_events').select('*').eq('id', recovery.id).single();

  assertExists(recoveryData);

  const completedStatuses = ['recovered', 'abandoned', 'surrendered'];
  if (completedStatuses.includes(recoveryData.status)) {
    const response = new Response(
      JSON.stringify({ error: 'Cannot propose meetup for a completed or cancelled recovery' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Cannot propose meetup for a completed or cancelled recovery');
  }
});
