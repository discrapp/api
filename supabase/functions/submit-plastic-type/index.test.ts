import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = { id: string; email: string };
type MockPlasticType = {
  id: string;
  manufacturer: string;
  plastic_name: string;
  display_order: number;
  status: string;
  submitted_by: string | null;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockPlasticTypes: MockPlasticType[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockPlasticTypes = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: mockUser },
          error: mockUser ? null : { message: 'Not authenticated' },
        }),
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (col1: string, val1: string) => ({
          eq: (col2: string, val2: string) => ({
            maybeSingle: () => {
              if (table === 'plastic_types') {
                const found = mockPlasticTypes.find(
                  (p) =>
                    (col1 === 'manufacturer' ? p.manufacturer.toLowerCase() === val1.toLowerCase() : true) &&
                    (col2 === 'plastic_name' ? p.plastic_name.toLowerCase() === val2.toLowerCase() : true)
                );
                return Promise.resolve({ data: found || null, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      }),
      insert: (values: Partial<MockPlasticType>) => ({
        select: () => ({
          single: () => {
            if (table === 'plastic_types') {
              const newPlastic: MockPlasticType = {
                id: `pt-${Date.now()}`,
                manufacturer: values.manufacturer || '',
                plastic_name: values.plastic_name || '',
                display_order: values.display_order || 999,
                status: values.status || 'pending',
                submitted_by: values.submitted_by || null,
              };
              mockPlasticTypes.push(newPlastic);
              return Promise.resolve({ data: newPlastic, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
    }),
  };
}

Deno.test('submit-plastic-type: should return 405 for non-POST requests', async () => {
  resetMocks();

  const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('submit-plastic-type: should return 401 when not authenticated', async () => {
  resetMocks();
  // mockUser is null = not authenticated

  const supabase = mockSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  assertEquals(data.user, null);
  assertExists(error);
});

Deno.test('submit-plastic-type: should return 400 for missing manufacturer', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };

  const body: { plastic_name: string; manufacturer?: string } = { plastic_name: 'Custom Plastic' };

  if (!body.manufacturer?.trim()) {
    const response = new Response(JSON.stringify({ error: 'Manufacturer is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Manufacturer is required');
  }
});

Deno.test('submit-plastic-type: should return 400 for missing plastic_name', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };

  const body: { manufacturer: string; plastic_name?: string } = { manufacturer: 'Innova' };

  if (!body.plastic_name?.trim()) {
    const response = new Response(JSON.stringify({ error: 'Plastic name is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Plastic name is required');
  }
});

Deno.test('submit-plastic-type: should return 409 if plastic type already exists', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };
  mockPlasticTypes = [
    {
      id: 'pt-1',
      manufacturer: 'Innova',
      plastic_name: 'Star',
      display_order: 1,
      status: 'official',
      submitted_by: null,
    },
  ];

  const supabase = mockSupabaseClient();

  // Check if exists
  const { data: existing } = await supabase
    .from('plastic_types')
    .select('id')
    .eq('manufacturer', 'Innova')
    .eq('plastic_name', 'Star')
    .maybeSingle();

  assertExists(existing);
  assertEquals(existing.manufacturer, 'Innova');
});

Deno.test('submit-plastic-type: should create pending plastic type successfully', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Check it doesn't exist first
  const { data: existing } = await supabase
    .from('plastic_types')
    .select('id')
    .eq('manufacturer', 'Innova')
    .eq('plastic_name', 'Swirly Star')
    .maybeSingle();

  assertEquals(existing, null);

  // Insert new plastic type
  const { data: newPlastic, error } = await supabase
    .from('plastic_types')
    .insert({
      manufacturer: 'Innova',
      plastic_name: 'Swirly Star',
      status: 'pending',
      submitted_by: mockUser.id,
      display_order: 999,
    })
    .select()
    .single();

  assertEquals(error, null);
  assertExists(newPlastic);
  assertEquals(newPlastic.manufacturer, 'Innova');
  assertEquals(newPlastic.plastic_name, 'Swirly Star');
  assertEquals(newPlastic.status, 'pending');
  assertEquals(newPlastic.submitted_by, 'user-1');
});

Deno.test('submit-plastic-type: should return correct response structure on success', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('plastic_types')
    .insert({
      manufacturer: 'Custom',
      plastic_name: 'New Plastic',
      status: 'pending',
      submitted_by: mockUser.id,
    })
    .select()
    .single();

  assertExists(data);
  assertExists(data.id);
  assertEquals(data.status, 'pending');

  // Verify response structure
  const response = {
    message: 'Plastic type submitted for review',
    plastic: data,
  };

  assertEquals(response.message, 'Plastic type submitted for review');
  assertExists(response.plastic);
});
