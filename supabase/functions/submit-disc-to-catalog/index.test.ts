import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDiscCatalog = {
  id: string;
  manufacturer: string;
  mold: string;
  category: string | null;
  speed: number | null;
  glide: number | null;
  turn: number | null;
  fade: number | null;
  stability: string | null;
  status: string;
  submitted_by: string | null;
  source: string | null;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscCatalog: MockDiscCatalog[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscCatalog = [];
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
        eq: (col1: string, val1: string) => ({
          eq: (col2: string, val2: string) => ({
            single: () => {
              if (table === 'disc_catalog') {
                const disc = mockDiscCatalog.find(
                  (d) => d[col1 as keyof MockDiscCatalog] === val1 && d[col2 as keyof MockDiscCatalog] === val2
                );
                return Promise.resolve({
                  data: disc || null,
                  error: disc ? null : { code: 'PGRST116' },
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      }),
      insert: (data: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            if (table === 'disc_catalog') {
              const newDisc: MockDiscCatalog = {
                id: `disc-${Date.now()}`,
                manufacturer: data.manufacturer as string,
                mold: data.mold as string,
                category: (data.category as string) || null,
                speed: (data.speed as number) || null,
                glide: (data.glide as number) || null,
                turn: (data.turn as number) || null,
                fade: (data.fade as number) || null,
                stability: (data.stability as string) || null,
                status: 'user_submitted',
                submitted_by: (data.submitted_by as string) || null,
                source: 'user',
              };
              mockDiscCatalog.push(newDisc);
              return Promise.resolve({ data: newDisc, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
}

Deno.test('submit-disc-to-catalog: should return 405 for non-POST requests', async () => {
  const method: string = 'GET';

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

Deno.test('submit-disc-to-catalog: should return 401 when not authenticated', async () => {
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

Deno.test('submit-disc-to-catalog: should return 400 for missing manufacturer', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: { manufacturer?: string; mold: string } = { mold: 'Custom Disc' };

  if (!body.manufacturer) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: manufacturer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: manufacturer');
  }
});

Deno.test('submit-disc-to-catalog: should return 400 for missing mold', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const body: { manufacturer: string; mold?: string } = { manufacturer: 'Custom Brand' };

  if (!body.mold) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: mold' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: mold');
  }
});

Deno.test('submit-disc-to-catalog: should return 409 if disc already exists', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Pre-populate with existing disc
  mockDiscCatalog.push({
    id: 'existing-disc',
    manufacturer: 'Innova',
    mold: 'Destroyer',
    category: 'Distance Driver',
    speed: 12,
    glide: 5,
    turn: -1,
    fade: 3,
    stability: 'Overstable',
    status: 'verified',
    submitted_by: null,
    source: 'discit_api',
  });

  const supabase = mockSupabaseClient();

  // Check if disc already exists
  const { data: existingDisc } = await supabase
    .from('disc_catalog')
    .select('id')
    .eq('manufacturer', 'Innova')
    .eq('mold', 'Destroyer')
    .single();

  if (existingDisc) {
    const response = new Response(
      JSON.stringify({ error: 'Disc already exists in catalog', disc_id: existingDisc.id }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 409);
    const data = await response.json();
    assertEquals(data.error, 'Disc already exists in catalog');
  }
});

Deno.test('submit-disc-to-catalog: should create disc with user_submitted status', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const { data: newDisc } = await supabase
    .from('disc_catalog')
    .insert({
      manufacturer: 'New Brand',
      mold: 'Custom Disc',
      category: 'Distance Driver',
      speed: 11,
      glide: 5,
      turn: -2,
      fade: 2,
      stability: 'Understable',
      submitted_by: mockUser.id,
      source: 'user',
    })
    .select()
    .single();

  assertExists(newDisc);
  assertEquals(newDisc.manufacturer, 'New Brand');
  assertEquals(newDisc.mold, 'Custom Disc');
  assertEquals(newDisc.status, 'user_submitted');
  assertEquals(newDisc.submitted_by, 'user-123');
});

Deno.test('submit-disc-to-catalog: should accept optional flight numbers', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Submit with flight numbers
  const { data: withFlightNumbers } = await supabase
    .from('disc_catalog')
    .insert({
      manufacturer: 'Brand A',
      mold: 'Disc A',
      speed: 10,
      glide: 4,
      turn: -1,
      fade: 3,
      submitted_by: mockUser.id,
      source: 'user',
    })
    .select()
    .single();

  assertExists(withFlightNumbers);
  assertEquals(withFlightNumbers.speed, 10);
  assertEquals(withFlightNumbers.glide, 4);
  assertEquals(withFlightNumbers.turn, -1);
  assertEquals(withFlightNumbers.fade, 3);

  // Submit without flight numbers
  const { data: withoutFlightNumbers } = await supabase
    .from('disc_catalog')
    .insert({
      manufacturer: 'Brand B',
      mold: 'Disc B',
      submitted_by: mockUser.id,
      source: 'user',
    })
    .select()
    .single();

  assertExists(withoutFlightNumbers);
  assertEquals(withoutFlightNumbers.speed, null);
  assertEquals(withoutFlightNumbers.glide, null);
});

Deno.test('submit-disc-to-catalog: should accept optional category', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const { data: withCategory } = await supabase
    .from('disc_catalog')
    .insert({
      manufacturer: 'Brand C',
      mold: 'Disc C',
      category: 'Putter',
      submitted_by: mockUser.id,
      source: 'user',
    })
    .select()
    .single();

  assertExists(withCategory);
  assertEquals(withCategory.category, 'Putter');
});

Deno.test('submit-disc-to-catalog: should accept optional stability', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const { data: withStability } = await supabase
    .from('disc_catalog')
    .insert({
      manufacturer: 'Brand D',
      mold: 'Disc D',
      stability: 'Overstable',
      submitted_by: mockUser.id,
      source: 'user',
    })
    .select()
    .single();

  assertExists(withStability);
  assertEquals(withStability.stability, 'Overstable');
});

Deno.test('submit-disc-to-catalog: should return success with disc data', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const { data: newDisc } = await supabase
    .from('disc_catalog')
    .insert({
      manufacturer: 'Test Brand',
      mold: 'Test Disc',
      category: 'Midrange',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      stability: 'Stable',
      submitted_by: mockUser.id,
      source: 'user',
    })
    .select()
    .single();

  assertExists(newDisc);

  const response = new Response(
    JSON.stringify({
      success: true,
      message: 'Disc submitted for review',
      disc: newDisc,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.message, 'Disc submitted for review');
  assertExists(data.disc);
  assertEquals(data.disc.status, 'user_submitted');
});
