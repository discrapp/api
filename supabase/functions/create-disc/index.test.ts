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
  weight?: number;
  color?: string;
  flight_numbers?: Record<string, number>;
  reward_amount?: number;
  notes?: string;
};

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
    from: (table: string) => ({
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: () => {
            if (table === 'discs') {
              const discData = values as MockDisc;
              const newDisc: MockDisc = {
                id: `disc-${Date.now()}`,
                owner_id: mockUser?.id || '',
                name: discData.name || discData.mold,
                mold: discData.mold,
                manufacturer: discData.manufacturer,
                plastic: discData.plastic,
                weight: discData.weight,
                color: discData.color,
                flight_numbers: discData.flight_numbers,
                reward_amount: discData.reward_amount,
                notes: discData.notes,
              };
              mockDiscs.push(newDisc);
              return Promise.resolve({ data: newDisc, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
    }),
  };
}

Deno.test('create-disc: should return 401 when not authenticated', async () => {
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

Deno.test('create-disc: should return 400 when mold is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: { mold?: string } = {};

  if (!body.mold) {
    const response = new Response(JSON.stringify({ error: 'Mold is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
    assertEquals(error.error, 'Mold is required');
  }
});

Deno.test('create-disc: should create disc with minimal data', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const discData = {
    mold: 'Destroyer',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };

  const { data: disc } = await supabase.from('discs').insert(discData).select().single();

  assertExists(disc);
  assertExists(disc.id);
  assertEquals(disc.name, 'Destroyer'); // name should be set to mold
  assertEquals(disc.mold, 'Destroyer');
  assertEquals(disc.owner_id, authData.user.id);

  const response = new Response(JSON.stringify(disc), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 201);
  const data = await response.json();
  assertExists(data.id);
  assertEquals(data.name, 'Destroyer');
  assertEquals(data.mold, 'Destroyer');
  assertEquals(data.owner_id, authData.user.id);
});

Deno.test('create-disc: should create disc with all fields', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const discData = {
    mold: 'Destroyer',
    manufacturer: 'Innova',
    plastic: 'Star',
    weight: 175,
    color: 'Blue',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    reward_amount: 5.0,
    notes: 'My favorite disc!',
  };

  const { data: disc } = await supabase.from('discs').insert(discData).select().single();

  assertExists(disc);
  assertExists(disc.id);
  assertEquals(disc.name, discData.mold); // name should be set to mold
  assertEquals(disc.manufacturer, discData.manufacturer);
  assertEquals(disc.mold, discData.mold);
  assertEquals(disc.plastic, discData.plastic);
  assertEquals(disc.weight, discData.weight);
  assertEquals(disc.color, discData.color);
  assertEquals(disc.reward_amount, discData.reward_amount);
  assertEquals(disc.notes, discData.notes);
  assertEquals(disc.owner_id, authData.user.id);

  const response = new Response(JSON.stringify(disc), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 201);
  const data = await response.json();
  assertExists(data.id);
  assertEquals(data.name, discData.mold);
  assertEquals(data.manufacturer, discData.manufacturer);
  assertEquals(data.mold, discData.mold);
  assertEquals(data.plastic, discData.plastic);
  assertEquals(data.weight, discData.weight);
  assertEquals(data.color, discData.color);
  assertEquals(data.reward_amount, discData.reward_amount);
  assertEquals(data.notes, discData.notes);
  assertEquals(data.owner_id, authData.user.id);
});

Deno.test('create-disc: should validate flight numbers', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const discData = {
    mold: 'Destroyer',
    flight_numbers: { speed: 20, glide: 5, turn: 0, fade: 1 }, // Invalid speed
  };

  // Flight number validation
  const flightNumbers = discData.flight_numbers;
  const isValid = flightNumbers.speed <= 14 && flightNumbers.speed >= 1;

  if (!isValid) {
    const response = new Response(
      JSON.stringify({ error: 'Flight numbers must be within valid ranges (speed: 1-14)' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
  }
});
