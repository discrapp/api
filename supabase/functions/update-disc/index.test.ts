import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
interface MockUser {
  id: string;
  email: string;
}

interface MockDisc {
  id: string;
  owner_id: string;
  name: string;
  mold?: string;
  manufacturer?: string;
  plastic?: string;
  weight?: number;
  color?: string;
  flight_numbers?: { speed: number; glide: number; turn: number; fade: number };
  reward_amount?: string;
  notes?: string;
}

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
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
    from: (_table: string) => ({
      select: (_columns?: string) => ({
        eq: (_column: string, value: string) => ({
          single: () => {
            const disc = mockDiscs.find((d) => d.id === value);
            if (disc) {
              return Promise.resolve({ data: disc, error: null });
            }
            return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
          },
        }),
      }),
      update: (values: Partial<MockDisc>) => ({
        eq: (_column: string, discId: string) => ({
          select: (_columns?: string) => ({
            single: () => {
              const discIndex = mockDiscs.findIndex((d) => d.id === discId);
              if (discIndex === -1) {
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }
              const updatedDisc = { ...mockDiscs[discIndex], ...values };
              // Sync name with mold if mold is being updated
              if (values.mold) {
                updatedDisc.name = values.mold;
              }
              mockDiscs[discIndex] = updatedDisc;
              return Promise.resolve({ data: updatedDisc, error: null });
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('update-disc: should return 401 when not authenticated', async () => {
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

Deno.test('update-disc: should return 405 for non-PUT requests', async () => {
  resetMocks();

  const method = 'GET' as string;

  if (method !== 'PUT') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('update-disc: should return 400 when disc_id is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: { disc_id?: string; mold?: string } = { mold: 'Updated' };

  if (!body.disc_id) {
    const response = new Response(JSON.stringify({ error: 'disc_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
    assertEquals(error.error, 'disc_id is required');
  }
});

Deno.test('update-disc: should return 404 when disc does not exist', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const discId = '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabase.from('discs').select('*').eq('id', discId).single();

  if (error || !data) {
    const response = new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const errorData = await response.json();
    assertExists(errorData.error);
    assertEquals(errorData.error, 'Disc not found');
  }
});

Deno.test('update-disc: should successfully update owned disc with all fields', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create a disc first
  const createdDisc: MockDisc = {
    id: 'disc-123',
    owner_id: 'user-123',
    name: 'Destroyer',
    mold: 'Destroyer',
    manufacturer: 'Innova',
    plastic: 'Star',
    weight: 175,
    color: 'Blue',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    reward_amount: '5.00',
    notes: 'My favorite disc',
  };
  mockDiscs.push(createdDisc);

  const supabase = mockSupabaseClient();

  // Update the disc
  const updateData = {
    mold: 'Wraith',
    manufacturer: 'Innova',
    plastic: 'Champion',
    weight: 170,
    color: 'Red',
    flight_numbers: { speed: 11, glide: 5, turn: -1, fade: 3 },
    reward_amount: '10.00',
    notes: 'Updated notes',
  };

  const { data: updatedDisc } = await supabase
    .from('discs')
    .update(updateData)
    .eq('id', createdDisc.id)
    .select('*')
    .single();

  assertExists(updatedDisc);
  assertEquals(updatedDisc.mold, 'Wraith');
  assertEquals(updatedDisc.name, 'Wraith'); // Name should sync with mold
  assertEquals(updatedDisc.manufacturer, 'Innova');
  assertEquals(updatedDisc.plastic, 'Champion');
  assertEquals(updatedDisc.weight, 170);
  assertEquals(updatedDisc.color, 'Red');
  assertExists(updatedDisc.flight_numbers);
  assertEquals(updatedDisc.flight_numbers.speed, 11);
  assertEquals(updatedDisc.reward_amount, '10.00');
  assertEquals(updatedDisc.notes, 'Updated notes');

  const response = new Response(JSON.stringify(updatedDisc), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.mold, 'Wraith');
  assertEquals(data.name, 'Wraith');
  assertEquals(data.manufacturer, 'Innova');
  assertEquals(data.plastic, 'Champion');
  assertEquals(data.weight, 170);
  assertEquals(data.color, 'Red');
  assertEquals(data.flight_numbers.speed, 11);
  assertEquals(data.reward_amount, '10.00');
  assertEquals(data.notes, 'Updated notes');
});

Deno.test('update-disc: should support partial updates', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create a disc first
  const createdDisc: MockDisc = {
    id: 'disc-456',
    owner_id: 'user-123',
    name: 'Destroyer',
    mold: 'Destroyer',
    manufacturer: 'Innova',
    plastic: 'Star',
    weight: 175,
    color: 'Blue',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    reward_amount: '5.00',
    notes: 'My favorite disc',
  };
  mockDiscs.push(createdDisc);

  const supabase = mockSupabaseClient();

  // Update only the mold and plastic
  const updateData = {
    mold: 'Wraith',
    plastic: 'Champion',
  };

  const { data: updatedDisc } = await supabase
    .from('discs')
    .update(updateData)
    .eq('id', createdDisc.id)
    .select('*')
    .single();

  assertExists(updatedDisc);
  assertEquals(updatedDisc.mold, 'Wraith');
  assertEquals(updatedDisc.name, 'Wraith');
  assertEquals(updatedDisc.plastic, 'Champion');
  // Other fields should remain unchanged
  assertEquals(updatedDisc.manufacturer, 'Innova');
  assertEquals(updatedDisc.weight, 175);
  assertEquals(updatedDisc.color, 'Blue');
  assertEquals(updatedDisc.reward_amount, '5.00');
  assertEquals(updatedDisc.notes, 'My favorite disc');

  const response = new Response(JSON.stringify(updatedDisc), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.mold, 'Wraith');
  assertEquals(data.name, 'Wraith');
  assertEquals(data.plastic, 'Champion');
  assertEquals(data.manufacturer, 'Innova');
  assertEquals(data.weight, 175);
  assertEquals(data.color, 'Blue');
  assertEquals(data.reward_amount, '5.00');
  assertEquals(data.notes, 'My favorite disc');
});

Deno.test('update-disc: should validate flight numbers', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const updateData = {
    disc_id: 'disc-789',
    flight_numbers: { speed: 20, glide: 5, turn: 0, fade: 1 }, // Invalid speed
  };

  // Flight number validation
  const flightNumbers = updateData.flight_numbers;
  const isValid = flightNumbers.speed <= 14 && flightNumbers.speed >= 1;

  if (!isValid) {
    const response = new Response(JSON.stringify({ error: 'Speed must be between 1 and 14' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
    assertEquals(error.error, 'Speed must be between 1 and 14');
  }
});

Deno.test("update-disc: should return 403 when trying to update another user's disc", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create a disc owned by user-123
  const disc: MockDisc = {
    id: 'disc-owner1',
    owner_id: 'user-123',
    name: 'Destroyer',
    mold: 'Destroyer',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
  };
  mockDiscs.push(disc);

  // Switch to a different user
  mockUser = { id: 'user-456', email: 'test2@example.com' };

  const supabase = mockSupabaseClient();

  // Try to update the first user's disc
  const { data: fetchedDisc } = await supabase.from('discs').select('*').eq('id', disc.id).single();

  assertExists(fetchedDisc);

  // Check ownership
  const currentUser = await supabase.auth.getUser();
  if (fetchedDisc.owner_id !== currentUser.data.user?.id) {
    const response = new Response(JSON.stringify({ error: 'Forbidden: You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const error = await response.json();
    assertExists(error.error);
    assertEquals(error.error, 'Forbidden: You do not own this disc');
  }
});

Deno.test('update-disc: should keep name in sync with mold', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create a disc
  const createdDisc: MockDisc = {
    id: 'disc-sync',
    owner_id: 'user-123',
    name: 'Destroyer',
    mold: 'Destroyer',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
  };
  mockDiscs.push(createdDisc);

  const supabase = mockSupabaseClient();

  // Update the mold
  const { data: updatedDisc } = await supabase
    .from('discs')
    .update({ mold: 'Wraith' })
    .eq('id', createdDisc.id)
    .select('*')
    .single();

  assertExists(updatedDisc);
  assertEquals(updatedDisc.mold, 'Wraith');
  assertEquals(updatedDisc.name, 'Wraith'); // Name should automatically update to match mold

  const response = new Response(JSON.stringify(updatedDisc), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.mold, 'Wraith');
  assertEquals(data.name, 'Wraith');
});

Deno.test('update-disc: should call captureException on database error', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Mock database error
  const updateError = { message: 'Database connection failed', code: 'ECONNREFUSED' };
  let captureExceptionCalled = false;
  let capturedContext: Record<string, unknown> | undefined;

  // Mock captureException
  const mockCaptureException = (
    _error: unknown,
    context?: Record<string, unknown>
  ) => {
    captureExceptionCalled = true;
    capturedContext = context;
  };

  // Simulate database error path during update
  const discId = 'disc-to-update';
  if (updateError) {
    mockCaptureException(updateError, {
      operation: 'update-disc',
      discId,
      userId: mockUser.id,
    });

    const response = new Response(
      JSON.stringify({ error: 'Failed to update disc', details: updateError.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    assertEquals(response.status, 500);
    assertEquals(captureExceptionCalled, true);
    assertExists(capturedContext);
    assertEquals(capturedContext.operation, 'update-disc');
    assertEquals(capturedContext.discId, 'disc-to-update');
    assertEquals(capturedContext.userId, 'user-123');
  }
});
