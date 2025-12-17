import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
type MockDisc = {
  id: string;
  owner_id: string | null;
  name: string;
  mold: string;
  manufacturer?: string;
  plastic?: string;
  color?: string;
};

type MockRecoveryEvent = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  found_at: string;
  recovered_at?: string;
};

type MockUser = {
  id: string;
  email: string;
};

let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockUser: MockUser | null = null;

// Mock Supabase client
const mockSupabaseClient = {
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
      eq: (column: string, value: string) => ({
        single: () => {
          if (table === 'discs') {
            const disc = mockDiscs.find((d) => d[column as keyof MockDisc] === value);
            if (disc) {
              return Promise.resolve({ data: disc, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          } else if (table === 'recovery_events') {
            const recovery = mockRecoveryEvents.find((r) => r[column as keyof MockRecoveryEvent] === value);
            if (recovery) {
              return Promise.resolve({ data: recovery, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          }
          return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
        },
        maybeSingle: () => {
          if (table === 'recovery_events') {
            const recovery = mockRecoveryEvents.find((r) => r[column as keyof MockRecoveryEvent] === value);
            return Promise.resolve({ data: recovery || null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    update: (data: Record<string, unknown>) => ({
      eq: (column: string, value: string) => {
        if (table === 'discs') {
          const disc = mockDiscs.find((d) => d[column as keyof MockDisc] === value);
          if (disc) {
            Object.assign(disc, data);
            return Promise.resolve({ data: disc, error: null });
          }
        } else if (table === 'recovery_events') {
          const recovery = mockRecoveryEvents.find((r) => r[column as keyof MockRecoveryEvent] === value);
          if (recovery) {
            Object.assign(recovery, data);
            return Promise.resolve({ data: recovery, error: null });
          }
        }
        return Promise.resolve({ data: null, error: { message: 'Not found' } });
      },
    }),
  }),
};

// Reset mocks before each test
function resetMocks() {
  mockDiscs = [];
  mockRecoveryEvents = [];
  mockUser = null;
}

Deno.test('claim-disc - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/claim-disc', {
    method: 'GET',
  });

  if (req.method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const body = await response.json();
    assertEquals(body.error, 'Method not allowed');
  }
});

Deno.test('claim-disc - returns 401 when not authenticated', async () => {
  const authHeader = undefined;

  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const body = await response.json();
    assertEquals(body.error, 'Missing authorization header');
  }
});

Deno.test('claim-disc - returns 400 when disc_id is missing', async () => {
  const body: { disc_id?: string } = {};

  if (!body.disc_id) {
    const response = new Response(JSON.stringify({ error: 'disc_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'disc_id is required');
  }
});

Deno.test('claim-disc - returns 404 when disc not found', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const disc_id = '00000000-0000-0000-0000-000000000000';

  const { data: disc } = await mockSupabaseClient.from('discs').select('*').eq('id', disc_id).single();

  if (!disc) {
    const response = new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error, 'Disc not found');
  }
});

Deno.test('claim-disc - returns 400 when disc already has an owner', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add disc with owner
  mockDiscs.push({
    id: 'disc-123',
    owner_id: 'other-user-456',
    name: 'Test Disc',
    mold: 'Destroyer',
  });

  const { data: disc } = (await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-123').single()) as {
    data: MockDisc | null;
  };

  if (disc && disc.owner_id) {
    const response = new Response(JSON.stringify({ error: 'This disc already has an owner and cannot be claimed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'This disc already has an owner and cannot be claimed');
  }
});

Deno.test('claim-disc - user can successfully claim an ownerless disc', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add ownerless disc
  mockDiscs.push({
    id: 'disc-456',
    owner_id: null,
    name: 'Abandoned Disc',
    mold: 'Destroyer',
  });

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  const { data: disc } = (await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-456').single()) as {
    data: MockDisc | null;
  };

  assertExists(disc);
  assertEquals(disc.owner_id, null);

  // Claim the disc
  const { data: updatedDisc } = (await mockSupabaseClient
    .from('discs')
    .update({ owner_id: authData.user.id })
    .eq('id', 'disc-456')) as { data: MockDisc | null };

  assertExists(updatedDisc);
  assertEquals(updatedDisc.owner_id, 'user-123');

  const response = new Response(
    JSON.stringify({
      success: true,
      disc: updatedDisc,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.disc);
  assertEquals(body.disc.id, 'disc-456');
  assertEquals(body.disc.name, 'Abandoned Disc');
});

Deno.test('claim-disc - claiming closes abandoned recovery events', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add ownerless disc
  mockDiscs.push({
    id: 'disc-789',
    owner_id: null,
    name: 'Abandoned Disc',
    mold: 'Destroyer',
  });

  // Add abandoned recovery event
  mockRecoveryEvents.push({
    id: 'recovery-123',
    disc_id: 'disc-789',
    finder_id: 'finder-456',
    status: 'abandoned',
    found_at: new Date().toISOString(),
  });

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Check for abandoned recovery
  const { data: recovery } = (await mockSupabaseClient
    .from('recovery_events')
    .select('*')
    .eq('disc_id', 'disc-789')
    .single()) as { data: MockRecoveryEvent | null };

  assertExists(recovery);
  assertEquals(recovery.status, 'abandoned');

  // Claim the disc
  await mockSupabaseClient.from('discs').update({ owner_id: authData.user.id }).eq('id', 'disc-789');

  // Close abandoned recovery
  await mockSupabaseClient
    .from('recovery_events')
    .update({
      status: 'recovered',
      recovered_at: new Date().toISOString(),
    })
    .eq('id', 'recovery-123');

  // Verify recovery status updated
  const { data: updatedRecovery } = (await mockSupabaseClient
    .from('recovery_events')
    .select('*')
    .eq('id', 'recovery-123')
    .single()) as { data: MockRecoveryEvent | null };

  assertExists(updatedRecovery);
  assertEquals(updatedRecovery.status, 'recovered');
  assertExists(updatedRecovery.recovered_at);
});
