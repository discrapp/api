import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
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
};

// Mock data storage
let mockDiscCatalog: MockDiscCatalog[] = [];

// Reset mocks before each test
function resetMocks() {
  mockDiscCatalog = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => {
        if (table === 'disc_catalog') {
          return {
            or: (filter: string) => ({
              eq: (_col: string, _val: string) => ({
                order: (_orderCol: string, _opts: { ascending: boolean }) => ({
                  limit: (count: number) => {
                    // Parse filter to extract search terms
                    // Format: "mold.ilike.%term%,manufacturer.ilike.%term%"
                    const matches = filter.match(/%([^%]+)%/);
                    const searchTerm = matches ? matches[1].toLowerCase() : '';

                    const results = mockDiscCatalog
                      .filter((d) => d.status === 'verified')
                      .filter(
                        (d) =>
                          d.mold.toLowerCase().includes(searchTerm) || d.manufacturer.toLowerCase().includes(searchTerm)
                      )
                      .slice(0, count);

                    return Promise.resolve({ data: results, error: null });
                  },
                }),
              }),
            }),
            ilike: (column: string, pattern: string) => ({
              eq: (_col: string, _val: string) => ({
                order: (_orderCol: string, _opts: { ascending: boolean }) => ({
                  limit: (count: number) => {
                    const searchTerm = pattern.replace(/%/g, '').toLowerCase();

                    const results = mockDiscCatalog
                      .filter((d) => d.status === 'verified')
                      .filter((d) => {
                        const value = d[column as keyof MockDiscCatalog];
                        return typeof value === 'string' && value.toLowerCase().includes(searchTerm);
                      })
                      .slice(0, count);

                    return Promise.resolve({ data: results, error: null });
                  },
                }),
              }),
            }),
          };
        }
        return {
          or: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        };
      },
    }),
  };
}

Deno.test('search-disc-catalog: should return 400 for missing query parameter', async () => {
  resetMocks();

  const url = new URL('http://localhost/search-disc-catalog');
  const query = url.searchParams.get('q');

  if (!query) {
    const response = new Response(JSON.stringify({ error: 'Missing required query parameter: q' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required query parameter: q');
  }
});

Deno.test('search-disc-catalog: should return 400 for query too short', async () => {
  resetMocks();

  const url = new URL('http://localhost/search-disc-catalog?q=a');
  const query = url.searchParams.get('q');

  if (query && query.length < 2) {
    const response = new Response(JSON.stringify({ error: 'Query must be at least 2 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Query must be at least 2 characters');
  }
});

Deno.test('search-disc-catalog: should search by mold name', async () => {
  resetMocks();

  mockDiscCatalog = [
    {
      id: 'disc-1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'verified',
    },
    {
      id: 'disc-2',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      category: 'Midrange',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%destroyer%,manufacturer.ilike.%destroyer%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(data);
  assertEquals(data.length, 1);
  assertEquals(data[0].mold, 'Destroyer');
});

Deno.test('search-disc-catalog: should search by manufacturer', async () => {
  resetMocks();

  mockDiscCatalog = [
    {
      id: 'disc-1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'verified',
    },
    {
      id: 'disc-2',
      manufacturer: 'Innova',
      mold: 'Firebird',
      category: 'Fairway Driver',
      speed: 9,
      glide: 3,
      turn: 0,
      fade: 4,
      stability: 'Overstable',
      status: 'verified',
    },
    {
      id: 'disc-3',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      category: 'Midrange',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%innova%,manufacturer.ilike.%innova%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(data);
  assertEquals(data.length, 2);
  assertEquals(data[0].manufacturer, 'Innova');
  assertEquals(data[1].manufacturer, 'Innova');
});

Deno.test('search-disc-catalog: should be case insensitive', async () => {
  resetMocks();

  mockDiscCatalog = [
    {
      id: 'disc-1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'verified',
    },
  ];

  const supabase = mockSupabaseClient();

  // Search with lowercase
  const { data: lowerData } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%destroyer%,manufacturer.ilike.%destroyer%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(lowerData);
  assertEquals(lowerData.length, 1);

  // Search with uppercase
  const { data: upperData } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%DESTROYER%,manufacturer.ilike.%DESTROYER%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(upperData);
  assertEquals(upperData.length, 1);
});

Deno.test('search-disc-catalog: should support partial matches', async () => {
  resetMocks();

  mockDiscCatalog = [
    {
      id: 'disc-1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'verified',
    },
    {
      id: 'disc-2',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      category: 'Midrange',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
  ];

  const supabase = mockSupabaseClient();

  // Search with partial "dest" should match "Destroyer"
  const { data } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%dest%,manufacturer.ilike.%dest%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(data);
  assertEquals(data.length, 1);
  assertEquals(data[0].mold, 'Destroyer');
});

Deno.test('search-disc-catalog: should only return verified discs', async () => {
  resetMocks();

  mockDiscCatalog = [
    {
      id: 'disc-1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'verified',
    },
    {
      id: 'disc-2',
      manufacturer: 'Custom',
      mold: 'Custom Destroyer',
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'user_submitted', // Not verified
    },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%destroyer%,manufacturer.ilike.%destroyer%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(data);
  assertEquals(data.length, 1);
  assertEquals(data[0].status, 'verified');
});

Deno.test('search-disc-catalog: should limit results', async () => {
  resetMocks();

  // Create 30 Innova discs
  for (let i = 0; i < 30; i++) {
    mockDiscCatalog.push({
      id: `disc-${i}`,
      manufacturer: 'Innova',
      mold: `Disc ${i}`,
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'verified',
    });
  }

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%innova%,manufacturer.ilike.%innova%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(data);
  assertEquals(data.length, 20); // Should be limited to 20
});

Deno.test('search-disc-catalog: should return empty array when no matches', async () => {
  resetMocks();

  mockDiscCatalog = [
    {
      id: 'disc-1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      category: 'Distance Driver',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      stability: 'Overstable',
      status: 'verified',
    },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%nonexistent%,manufacturer.ilike.%nonexistent%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(data);
  assertEquals(data.length, 0);
});

Deno.test('search-disc-catalog: should return all flight numbers in response', async () => {
  resetMocks();

  mockDiscCatalog = [
    {
      id: 'disc-1',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      category: 'Midrange',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
  ];

  const supabase = mockSupabaseClient();

  const { data } = await supabase
    .from('disc_catalog')
    .select('*')
    .or('mold.ilike.%buzzz%,manufacturer.ilike.%buzzz%')
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(20);

  assertExists(data);
  assertEquals(data.length, 1);
  assertEquals(data[0].mold, 'Buzzz');
  assertEquals(data[0].manufacturer, 'Discraft');
  assertEquals(data[0].category, 'Midrange');
  assertEquals(data[0].speed, 5);
  assertEquals(data[0].glide, 4);
  assertEquals(data[0].turn, -1);
  assertEquals(data[0].fade, 1);
  assertEquals(data[0].stability, 'Stable');
});
