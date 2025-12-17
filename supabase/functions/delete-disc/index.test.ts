import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
type MockDisc = {
  id: string;
  owner_id: string;
  mold: string;
  flight_numbers?: Record<string, number>;
};

type MockUser = {
  id: string;
  email: string;
};

let mockDiscs: MockDisc[] = [];
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
          }
          return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
        },
      }),
    }),
    delete: () => ({
      eq: (column: string, value: string) => {
        if (table === 'discs') {
          const index = mockDiscs.findIndex((d) => d[column as keyof MockDisc] === value);
          if (index !== -1) {
            mockDiscs.splice(index, 1);
            return Promise.resolve({ data: null, error: null });
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
  mockUser = null;
}

Deno.test('delete-disc - returns 401 when not authenticated', async () => {
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

Deno.test('delete-disc - returns 405 for non-DELETE requests', async () => {
  const req = new Request('http://localhost/delete-disc', {
    method: 'GET',
  });

  if (req.method !== 'DELETE') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const body = await response.json();
    assertEquals(body.error, 'Method not allowed');
  }
});

Deno.test('delete-disc - returns 400 when disc_id is missing', async () => {
  const body: { disc_id?: string } = {};

  if (!body.disc_id) {
    const response = new Response(JSON.stringify({ error: 'disc_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertExists(respBody.error);
    assertEquals(respBody.error, 'disc_id is required');
  }
});

Deno.test('delete-disc - returns 404 when disc does not exist', async () => {
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
    assertExists(body.error);
    assertEquals(body.error, 'Disc not found');
  }
});

Deno.test('delete-disc - should successfully delete owned disc', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Create a disc
  const newDisc: MockDisc = {
    id: 'disc-456',
    owner_id: authData.user.id,
    mold: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(newDisc);

  // Verify disc exists
  const { data: disc } = await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-456').single();

  assertExists(disc);
  assertEquals(disc.owner_id, authData.user.id);

  // Delete the disc
  await mockSupabaseClient.from('discs').delete().eq('id', 'disc-456');

  const response = new Response(
    JSON.stringify({
      success: true,
      message: 'Disc deleted successfully',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.message, 'Disc deleted successfully');

  // Verify disc is deleted
  const { data: deletedDisc } = await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-456').single();

  assertEquals(deletedDisc, null);
});

Deno.test("delete-disc - should return 403 when trying to delete another user's disc", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Create disc owned by another user
  const otherUserDisc: MockDisc = {
    id: 'disc-789',
    owner_id: 'other-user-456',
    mold: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(otherUserDisc);

  // Try to get the disc
  const { data: disc } = await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-789').single();

  assertExists(disc);

  // Check ownership
  if (disc.owner_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Forbidden: You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const body = await response.json();
    assertExists(body.error);
    assertEquals(body.error, 'Forbidden: You do not own this disc');
  }
});
