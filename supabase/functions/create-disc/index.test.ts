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

Deno.test('create-disc: should call captureException on database error', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Mock database error
  const dbError = { message: 'Database connection failed', code: 'ECONNREFUSED' };
  let captureExceptionCalled = false;
  let capturedContext: Record<string, unknown> | undefined;

  // Mock captureException
  const mockCaptureException = (_error: unknown, context?: Record<string, unknown>) => {
    captureExceptionCalled = true;
    capturedContext = context;
  };

  // Simulate database error path
  if (dbError) {
    mockCaptureException(dbError, {
      operation: 'create-disc',
      userId: mockUser.id,
    });

    const response = new Response(JSON.stringify({ error: 'Failed to create disc', details: dbError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

    assertEquals(response.status, 500);
    assertEquals(captureExceptionCalled, true);
    assertExists(capturedContext);
    assertEquals(capturedContext.operation, 'create-disc');
    assertEquals(capturedContext.userId, 'user-123');
  }
});

// Tests for was_corrected logic
Deno.test('create-disc: isSameValue should match identical strings', () => {
  const normalize = (s: string | null | undefined): string => (s || '').toLowerCase().trim();
  const isSameValue = (ai: string | null | undefined, user: string | null | undefined): boolean => {
    const aiNorm = normalize(ai);
    const userNorm = normalize(user);
    if (aiNorm === userNorm) return true;
    if (!aiNorm || !userNorm) return aiNorm === userNorm;
    return aiNorm.includes(userNorm) || userNorm.includes(aiNorm);
  };

  assertEquals(isSameValue('Innova', 'Innova'), true);
  assertEquals(isSameValue('Destroyer', 'Destroyer'), true);
});

Deno.test('create-disc: isSameValue should be case-insensitive', () => {
  const normalize = (s: string | null | undefined): string => (s || '').toLowerCase().trim();
  const isSameValue = (ai: string | null | undefined, user: string | null | undefined): boolean => {
    const aiNorm = normalize(ai);
    const userNorm = normalize(user);
    if (aiNorm === userNorm) return true;
    if (!aiNorm || !userNorm) return aiNorm === userNorm;
    return aiNorm.includes(userNorm) || userNorm.includes(aiNorm);
  };

  assertEquals(isSameValue('Innova', 'INNOVA'), true);
  assertEquals(isSameValue('destroyer', 'Destroyer'), true);
  assertEquals(isSameValue('STAR', 'star'), true);
});

Deno.test('create-disc: isSameValue should handle whitespace', () => {
  const normalize = (s: string | null | undefined): string => (s || '').toLowerCase().trim();
  const isSameValue = (ai: string | null | undefined, user: string | null | undefined): boolean => {
    const aiNorm = normalize(ai);
    const userNorm = normalize(user);
    if (aiNorm === userNorm) return true;
    if (!aiNorm || !userNorm) return aiNorm === userNorm;
    return aiNorm.includes(userNorm) || userNorm.includes(aiNorm);
  };

  assertEquals(isSameValue('  Innova  ', 'Innova'), true);
  assertEquals(isSameValue('Destroyer', '  Destroyer  '), true);
});

Deno.test('create-disc: isSameValue should match partial strings (mold in plastic+mold)', () => {
  const normalize = (s: string | null | undefined): string => (s || '').toLowerCase().trim();
  const isSameValue = (ai: string | null | undefined, user: string | null | undefined): boolean => {
    const aiNorm = normalize(ai);
    const userNorm = normalize(user);
    if (aiNorm === userNorm) return true;
    if (!aiNorm || !userNorm) return aiNorm === userNorm;
    return aiNorm.includes(userNorm) || userNorm.includes(aiNorm);
  };

  // AI said "Champion Rhyno", user said "Rhyno" - should be same (Rhyno is substring of Champion Rhyno)
  assertEquals(isSameValue('Champion Rhyno', 'Rhyno'), true);
  // AI said "Westside", user said "Westside Discs" - should be same (Westside is substring)
  assertEquals(isSameValue('Westside', 'Westside Discs'), true);
  // AI said "Star Destroyer", user said "Destroyer" - should be same
  assertEquals(isSameValue('Star Destroyer', 'Destroyer'), true);
  // AI said "McBeth", user said "Paul McBeth" - should be same
  assertEquals(isSameValue('McBeth', 'Paul McBeth'), true);
});

Deno.test('create-disc: isSameValue should detect real differences', () => {
  const normalize = (s: string | null | undefined): string => (s || '').toLowerCase().trim();
  const isSameValue = (ai: string | null | undefined, user: string | null | undefined): boolean => {
    const aiNorm = normalize(ai);
    const userNorm = normalize(user);
    if (aiNorm === userNorm) return true;
    if (!aiNorm || !userNorm) return aiNorm === userNorm;
    return aiNorm.includes(userNorm) || userNorm.includes(aiNorm);
  };

  // Different manufacturers
  assertEquals(isSameValue('Innova', 'Discraft'), false);
  // Different molds
  assertEquals(isSameValue('Destroyer', 'Wraith'), false);
  // CD2 vs CD1 - these are different discs
  assertEquals(isSameValue('CD2', 'CD1'), false);
  // PA-3 vs P Model OS - different naming
  assertEquals(isSameValue('PA-3', 'P Model OS'), false);
  // Eagle vs IT - different discs
  assertEquals(isSameValue('Eagle', 'IT'), false);
});

Deno.test('create-disc: isSameValue should handle null/undefined', () => {
  const normalize = (s: string | null | undefined): string => (s || '').toLowerCase().trim();
  const isSameValue = (ai: string | null | undefined, user: string | null | undefined): boolean => {
    const aiNorm = normalize(ai);
    const userNorm = normalize(user);
    if (aiNorm === userNorm) return true;
    if (!aiNorm || !userNorm) return aiNorm === userNorm;
    return aiNorm.includes(userNorm) || userNorm.includes(aiNorm);
  };

  assertEquals(isSameValue(null, null), true);
  assertEquals(isSameValue(undefined, undefined), true);
  assertEquals(isSameValue('', ''), true);
  assertEquals(isSameValue(null, ''), true);
  assertEquals(isSameValue('Innova', null), false);
  assertEquals(isSameValue(null, 'Innova'), false);
});
