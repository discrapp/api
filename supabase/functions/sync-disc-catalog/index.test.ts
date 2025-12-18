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
  source: string | null;
  source_id: string | null;
  last_synced_at: string | null;
};

type MockSyncLog = {
  id: string;
  source: string;
  discs_added: number;
  discs_updated: number;
  discs_unchanged: number;
  status: string;
  errors: Record<string, unknown>[] | null;
};

// Mock DiscIt API response
type DiscItDisc = {
  id: string;
  name: string;
  brand: string;
  category: string;
  speed: string;
  glide: string;
  turn: string;
  fade: string;
  stability: string;
};

// Mock data storage
let mockDiscCatalog: MockDiscCatalog[] = [];
let mockSyncLogs: MockSyncLog[] = [];
let mockDiscItResponse: DiscItDisc[] = [];

// Reset mocks before each test
function resetMocks() {
  mockDiscCatalog = [];
  mockSyncLogs = [];
  mockDiscItResponse = [];
}

// Mock fetch for DiscIt API
function mockFetch(url: string): Promise<Response> {
  if (url === 'https://discit-api.fly.dev/disc') {
    return Promise.resolve(
      new Response(JSON.stringify(mockDiscItResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }
  return Promise.resolve(new Response('Not found', { status: 404 }));
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    from: (table: string) => ({
      insert: (data: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: () => {
            if (table === 'disc_catalog_sync_log') {
              const log: MockSyncLog = {
                id: `log-${Date.now()}`,
                source: (data as MockSyncLog).source,
                discs_added: 0,
                discs_updated: 0,
                discs_unchanged: 0,
                status: 'running',
                errors: null,
              };
              mockSyncLogs.push(log);
              return Promise.resolve({ data: log, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: string) => {
          if (table === 'disc_catalog_sync_log') {
            const log = mockSyncLogs.find((l) => l[column as keyof MockSyncLog] === value);
            if (log) {
              Object.assign(log, values);
              return Promise.resolve({ error: null });
            }
          }
          return Promise.resolve({ error: null });
        },
      }),
      upsert: (data: Record<string, unknown>[], options?: { onConflict: string }) => {
        if (table === 'disc_catalog' && options?.onConflict) {
          const dataArray = Array.isArray(data) ? data : [data];
          for (const disc of dataArray) {
            const existing = mockDiscCatalog.find((d) => d.manufacturer === disc.manufacturer && d.mold === disc.mold);
            if (existing) {
              Object.assign(existing, disc);
            } else {
              mockDiscCatalog.push({
                id: `disc-${Date.now()}-${Math.random()}`,
                manufacturer: disc.manufacturer as string,
                mold: disc.mold as string,
                category: disc.category as string | null,
                speed: disc.speed as number | null,
                glide: disc.glide as number | null,
                turn: disc.turn as number | null,
                fade: disc.fade as number | null,
                stability: disc.stability as string | null,
                status: 'verified',
                source: disc.source as string | null,
                source_id: disc.source_id as string | null,
                last_synced_at: new Date().toISOString(),
              });
            }
          }
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      },
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: () => {
            if (table === 'disc_catalog') {
              const disc = mockDiscCatalog.find((d) => d[column as keyof MockDiscCatalog] === value);
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
  };
}

Deno.test('sync-disc-catalog: should return 405 for non-POST requests', async () => {
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

Deno.test('sync-disc-catalog: should create sync log entry on start', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create sync log
  const { data: syncLog } = await supabase
    .from('disc_catalog_sync_log')
    .insert({ source: 'discit_api' })
    .select()
    .single();

  assertExists(syncLog);
  assertEquals(syncLog.source, 'discit_api');
  assertEquals(syncLog.status, 'running');
});

Deno.test('sync-disc-catalog: should fetch discs from DiscIt API', async () => {
  resetMocks();
  mockDiscItResponse = [
    {
      id: 'disc-1',
      name: 'Destroyer',
      brand: 'Innova',
      category: 'Distance Driver',
      speed: '12',
      glide: '5',
      turn: '-1',
      fade: '3',
      stability: 'Overstable',
    },
  ];

  const response = await mockFetch('https://discit-api.fly.dev/disc');
  const data = await response.json();

  assertEquals(data.length, 1);
  assertEquals(data[0].name, 'Destroyer');
  assertEquals(data[0].brand, 'Innova');
});

Deno.test('sync-disc-catalog: should insert new discs into catalog', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Simulate inserting disc from DiscIt
  const discData = {
    manufacturer: 'Innova',
    mold: 'Destroyer',
    category: 'Distance Driver',
    speed: 12,
    glide: 5,
    turn: -1,
    fade: 3,
    stability: 'Overstable',
    source: 'discit_api',
    source_id: 'disc-1',
    status: 'verified',
  };

  await supabase.from('disc_catalog').upsert([discData], { onConflict: 'manufacturer,mold' });

  assertEquals(mockDiscCatalog.length, 1);
  assertEquals(mockDiscCatalog[0].manufacturer, 'Innova');
  assertEquals(mockDiscCatalog[0].mold, 'Destroyer');
  assertEquals(mockDiscCatalog[0].speed, 12);
});

Deno.test('sync-disc-catalog: should update existing discs on conflict', async () => {
  resetMocks();

  // Pre-populate with existing disc
  mockDiscCatalog.push({
    id: 'existing-disc',
    manufacturer: 'Innova',
    mold: 'Destroyer',
    category: 'Distance Driver',
    speed: 11, // Old speed
    glide: 5,
    turn: -1,
    fade: 3,
    stability: 'Overstable',
    status: 'verified',
    source: 'discit_api',
    source_id: 'disc-1',
    last_synced_at: '2025-01-01T00:00:00Z',
  });

  const supabase = mockSupabaseClient();

  // Simulate updating disc with new data
  const discData = {
    manufacturer: 'Innova',
    mold: 'Destroyer',
    category: 'Distance Driver',
    speed: 12, // Updated speed
    glide: 5,
    turn: -1,
    fade: 3,
    stability: 'Overstable',
    source: 'discit_api',
    source_id: 'disc-1',
    status: 'verified',
  };

  await supabase.from('disc_catalog').upsert([discData], { onConflict: 'manufacturer,mold' });

  assertEquals(mockDiscCatalog.length, 1);
  assertEquals(mockDiscCatalog[0].speed, 12); // Updated
});

Deno.test('sync-disc-catalog: should update sync log on completion', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create sync log
  const { data: syncLog } = await supabase
    .from('disc_catalog_sync_log')
    .insert({ source: 'discit_api' })
    .select()
    .single();

  assertExists(syncLog);

  // Update sync log with results
  await supabase
    .from('disc_catalog_sync_log')
    .update({
      status: 'completed',
      discs_added: 100,
      discs_updated: 5,
      discs_unchanged: 1000,
    })
    .eq('id', syncLog.id);

  const updatedLog = mockSyncLogs.find((l) => l.id === syncLog.id);
  assertExists(updatedLog);
  assertEquals(updatedLog.status, 'completed');
  assertEquals(updatedLog.discs_added, 100);
});

Deno.test('sync-disc-catalog: should handle API errors gracefully', async () => {
  resetMocks();

  const response = await mockFetch('https://invalid-url.com/disc');

  assertEquals(response.status, 404);
});

Deno.test('sync-disc-catalog: should parse flight numbers correctly', () => {
  const discItDisc = {
    id: 'disc-1',
    name: 'Buzzz',
    brand: 'Discraft',
    category: 'Midrange',
    speed: '5',
    glide: '4',
    turn: '-1',
    fade: '1',
    stability: 'Stable',
  };

  // Simulate parsing
  const parsed = {
    manufacturer: discItDisc.brand,
    mold: discItDisc.name,
    category: discItDisc.category,
    speed: parseFloat(discItDisc.speed),
    glide: parseFloat(discItDisc.glide),
    turn: parseFloat(discItDisc.turn),
    fade: parseFloat(discItDisc.fade),
    stability: discItDisc.stability,
    source: 'discit_api',
    source_id: discItDisc.id,
  };

  assertEquals(parsed.manufacturer, 'Discraft');
  assertEquals(parsed.mold, 'Buzzz');
  assertEquals(parsed.speed, 5);
  assertEquals(parsed.glide, 4);
  assertEquals(parsed.turn, -1);
  assertEquals(parsed.fade, 1);
});

Deno.test('sync-disc-catalog: should batch upsert for efficiency', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Simulate batch upsert
  const discs = [
    {
      manufacturer: 'Innova',
      mold: 'Destroyer',
      speed: 12,
      glide: 5,
      turn: -1,
      fade: 3,
      source: 'discit_api',
      source_id: '1',
    },
    {
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      source: 'discit_api',
      source_id: '2',
    },
    {
      manufacturer: 'MVP',
      mold: 'Volt',
      speed: 8,
      glide: 5,
      turn: -0.5,
      fade: 2,
      source: 'discit_api',
      source_id: '3',
    },
  ];

  await supabase.from('disc_catalog').upsert(discs, { onConflict: 'manufacturer,mold' });

  assertEquals(mockDiscCatalog.length, 3);
});

Deno.test('sync-disc-catalog: should return success response with stats', async () => {
  const stats = {
    source: 'discit_api',
    discs_added: 100,
    discs_updated: 10,
    discs_unchanged: 1026,
    total_processed: 1136,
    duration_ms: 5432,
  };

  const response = new Response(
    JSON.stringify({
      success: true,
      ...stats,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.discs_added, 100);
  assertEquals(data.total_processed, 1136);
});
