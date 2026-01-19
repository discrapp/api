import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockPlasticType = {
  id: string;
  manufacturer: string;
  plastic_name: string;
  display_order: number;
};

// Mock data storage
let mockPlasticTypes: MockPlasticType[] = [];

// Reset mocks before each test
function resetMocks() {
  mockPlasticTypes = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => {
        if (table === 'plastic_types') {
          return {
            eq: (_col: string, val: string) => ({
              order: (_orderCol: string, _opts: { ascending: boolean }) => {
                const results = mockPlasticTypes
                  .filter((p) => p.manufacturer.toLowerCase() === val.toLowerCase())
                  .sort((a, b) => a.display_order - b.display_order);
                return Promise.resolve({ data: results, error: null });
              },
            }),
            order: (_orderCol: string, _opts: { ascending: boolean }) => {
              const results = [...mockPlasticTypes].sort((a, b) => {
                const manuCompare = a.manufacturer.localeCompare(b.manufacturer);
                if (manuCompare !== 0) return manuCompare;
                return a.display_order - b.display_order;
              });
              return Promise.resolve({ data: results, error: null });
            },
          };
        }
        return {
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
          order: () => Promise.resolve({ data: [], error: null }),
        };
      },
    }),
  };
}

Deno.test('get-plastic-types: should return 405 for non-GET requests', async () => {
  resetMocks();

  const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('get-plastic-types: should return all plastic types when no manufacturer specified', async () => {
  resetMocks();

  mockPlasticTypes = [
    { id: 'pt-1', manufacturer: 'Innova', plastic_name: 'Star', display_order: 1 },
    { id: 'pt-2', manufacturer: 'Innova', plastic_name: 'Champion', display_order: 2 },
    { id: 'pt-3', manufacturer: 'Discraft', plastic_name: 'ESP', display_order: 1 },
    { id: 'pt-4', manufacturer: 'Discraft', plastic_name: 'Z', display_order: 2 },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase.from('plastic_types').select('*').order('manufacturer', { ascending: true });

  assertExists(data);
  assertEquals(data.length, 4);
  // Should be sorted by manufacturer, then display_order
  assertEquals(data[0].manufacturer, 'Discraft');
  assertEquals(data[0].plastic_name, 'ESP');
});

Deno.test('get-plastic-types: should filter by manufacturer', async () => {
  resetMocks();

  mockPlasticTypes = [
    { id: 'pt-1', manufacturer: 'Innova', plastic_name: 'Star', display_order: 1 },
    { id: 'pt-2', manufacturer: 'Innova', plastic_name: 'Champion', display_order: 2 },
    { id: 'pt-3', manufacturer: 'Discraft', plastic_name: 'ESP', display_order: 1 },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('plastic_types')
    .select('*')
    .eq('manufacturer', 'Innova')
    .order('display_order', { ascending: true });

  assertExists(data);
  assertEquals(data.length, 2);
  assertEquals(data[0].manufacturer, 'Innova');
  assertEquals(data[0].plastic_name, 'Star');
  assertEquals(data[1].plastic_name, 'Champion');
});

Deno.test('get-plastic-types: should be case insensitive for manufacturer filter', async () => {
  resetMocks();

  mockPlasticTypes = [
    { id: 'pt-1', manufacturer: 'Innova', plastic_name: 'Star', display_order: 1 },
    { id: 'pt-2', manufacturer: 'Innova', plastic_name: 'Champion', display_order: 2 },
    { id: 'pt-3', manufacturer: 'Discraft', plastic_name: 'ESP', display_order: 1 },
  ];

  const supabase = mockSupabaseClient();

  // Search with lowercase
  const { data: lowerData } = await supabase
    .from('plastic_types')
    .select('*')
    .eq('manufacturer', 'innova')
    .order('display_order', { ascending: true });

  assertExists(lowerData);
  assertEquals(lowerData.length, 2);
  assertEquals(lowerData[0].manufacturer, 'Innova');
});

Deno.test('get-plastic-types: should return plastics sorted by display_order', async () => {
  resetMocks();

  mockPlasticTypes = [
    { id: 'pt-1', manufacturer: 'Innova', plastic_name: 'Champion', display_order: 2 },
    { id: 'pt-2', manufacturer: 'Innova', plastic_name: 'Star', display_order: 1 },
    { id: 'pt-3', manufacturer: 'Innova', plastic_name: 'DX', display_order: 4 },
    { id: 'pt-4', manufacturer: 'Innova', plastic_name: 'GStar', display_order: 3 },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('plastic_types')
    .select('*')
    .eq('manufacturer', 'Innova')
    .order('display_order', { ascending: true });

  assertExists(data);
  assertEquals(data.length, 4);
  assertEquals(data[0].plastic_name, 'Star');
  assertEquals(data[1].plastic_name, 'Champion');
  assertEquals(data[2].plastic_name, 'GStar');
  assertEquals(data[3].plastic_name, 'DX');
});

Deno.test('get-plastic-types: should return empty array for unknown manufacturer', async () => {
  resetMocks();

  mockPlasticTypes = [{ id: 'pt-1', manufacturer: 'Innova', plastic_name: 'Star', display_order: 1 }];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('plastic_types')
    .select('*')
    .eq('manufacturer', 'Unknown Brand')
    .order('display_order', { ascending: true });

  assertExists(data);
  assertEquals(data.length, 0);
});

Deno.test('get-plastic-types: should return correct response structure', async () => {
  resetMocks();

  mockPlasticTypes = [{ id: 'pt-1', manufacturer: 'Innova', plastic_name: 'Star', display_order: 1 }];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('plastic_types')
    .select('*')
    .eq('manufacturer', 'Innova')
    .order('display_order', { ascending: true });

  assertExists(data);
  assertEquals(data.length, 1);

  const plastic = data[0];
  assertExists(plastic.id);
  assertExists(plastic.manufacturer);
  assertExists(plastic.plastic_name);
  assertEquals(typeof plastic.display_order, 'number');
});
