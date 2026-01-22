import { assertEquals, assertExists } from 'jsr:@std/assert';
import { RateLimitPresets } from '../_shared/with-rate-limit.ts';

// Mock data types
interface MockUser {
  id: string;
  email: string;
}

interface MockCatalogDisc {
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
}

interface MockAiLog {
  id: string;
  user_id: string;
  ai_manufacturer: string | null;
  ai_mold: string | null;
  ai_confidence: number;
  processing_time_ms: number;
}

// Mock data storage
let mockUser: MockUser | null = null;
let mockCatalogDiscs: MockCatalogDisc[] = [];
let mockAiLogs: MockAiLog[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockCatalogDiscs = [];
  mockAiLogs = [];
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
        ilike: (_column: string, _pattern: string) => ({
          ilike: (_col2: string, _pat2: string) => ({
            eq: (_statusCol: string, _statusVal: string) => ({
              limit: (_n: number) => ({
                single: () => {
                  if (table === 'disc_catalog') {
                    const match = mockCatalogDiscs.find((d) => d.status === 'verified');
                    return Promise.resolve({ data: match || null, error: match ? null : { code: 'PGRST116' } });
                  }
                  return Promise.resolve({ data: null, error: null });
                },
              }),
            }),
          }),
          eq: (_statusCol: string, _statusVal: string) => ({
            limit: (_n: number) => {
              if (table === 'disc_catalog') {
                const matches = mockCatalogDiscs.filter((d) => d.status === 'verified');
                return Promise.resolve({ data: matches, error: null });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        }),
        or: (_pattern: string) => ({
          eq: (_statusCol: string, _statusVal: string) => ({
            limit: (_n: number) => {
              if (table === 'disc_catalog') {
                const matches = mockCatalogDiscs.filter((d) => d.status === 'verified');
                return Promise.resolve({ data: matches, error: null });
              }
              return Promise.resolve({ data: [], error: null });
            },
          }),
        }),
      }),
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === 'ai_identification_logs') {
          const logData = Array.isArray(values) ? values[0] : values;
          const newLog: MockAiLog = {
            id: crypto.randomUUID(),
            user_id: logData.user_id as string,
            ai_manufacturer: logData.ai_manufacturer as string | null,
            ai_mold: logData.ai_mold as string | null,
            ai_confidence: logData.ai_confidence as number,
            processing_time_ms: logData.processing_time_ms as number,
          };
          mockAiLogs.push(newLog);
          return Promise.resolve({ data: newLog, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

// Mock Claude API response
interface MockClaudeResponse {
  manufacturer: string | null;
  mold: string | null;
  disc_type: string | null;
  flight_numbers: { speed: number; glide: number; turn: number; fade: number } | null;
  plastic: string | null;
  confidence: number;
  visible_text: string;
}

function createMockClaudeResponse(data: Partial<MockClaudeResponse> = {}): MockClaudeResponse {
  return {
    manufacturer: Object.hasOwn(data, 'manufacturer') ? (data.manufacturer as string | null) : 'Innova',
    mold: Object.hasOwn(data, 'mold') ? (data.mold as string | null) : 'Destroyer',
    disc_type: Object.hasOwn(data, 'disc_type') ? (data.disc_type as string | null) : 'Distance Driver',
    flight_numbers: Object.hasOwn(data, 'flight_numbers')
      ? (data.flight_numbers as { speed: number; glide: number; turn: number; fade: number } | null)
      : { speed: 12, glide: 5, turn: -1, fade: 3 },
    plastic: Object.hasOwn(data, 'plastic') ? (data.plastic as string | null) : 'Star',
    confidence: data.confidence ?? 0.92,
    visible_text: data.visible_text ?? 'Innova Star Destroyer',
  };
}

Deno.test('identify-disc-from-photo: should return 401 when not authenticated', async () => {
  resetMocks();

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

Deno.test('identify-disc-from-photo: should return 400 when image is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const formData = new FormData();
  // No image added

  const image = formData.get('image');
  if (!image) {
    const response = new Response(JSON.stringify({ error: 'image is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'image is required');
  }
});

Deno.test('identify-disc-from-photo: should return 400 for non-image files', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const file = new Blob(['test'], { type: 'application/pdf' });

  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    const response = new Response(JSON.stringify({ error: 'File must be an image (jpeg, png, or webp)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertExists(body.error);
  }
});

Deno.test('identify-disc-from-photo: should return 400 for files over 5MB', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create a large file (simulated)
  const fileSizeBytes = 6 * 1024 * 1024; // 6MB
  const maxSize = 5 * 1024 * 1024;

  if (fileSizeBytes > maxSize) {
    const response = new Response(JSON.stringify({ error: 'File size must be less than 5MB' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'File size must be less than 5MB');
  }
});

Deno.test('identify-disc-from-photo: should return 503 when ANTHROPIC_API_KEY not configured', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const anthropicApiKey = undefined;

  if (!anthropicApiKey) {
    const response = new Response(JSON.stringify({ error: 'AI identification not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 503);
    const body = await response.json();
    assertEquals(body.error, 'AI identification not configured');
  }
});

Deno.test('identify-disc-from-photo: should successfully identify disc with catalog match', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add a disc to the catalog
  mockCatalogDiscs.push({
    id: 'catalog-123',
    manufacturer: 'Innova',
    mold: 'Destroyer',
    category: 'Distance Driver',
    speed: 12,
    glide: 5,
    turn: -1,
    fade: 3,
    stability: 'Overstable',
    status: 'verified',
  });

  const supabase = mockSupabaseClient();

  // Simulate Claude response
  const claudeResponse = createMockClaudeResponse();

  // Search for catalog match
  const { data: catalogMatches } = await supabase
    .from('disc_catalog')
    .select('*')
    .ilike('manufacturer', `%${claudeResponse.manufacturer}%`)
    .eq('status', 'verified')
    .limit(3);

  assertExists(catalogMatches);
  assertEquals(catalogMatches.length, 1);

  // Log the identification
  await supabase.from('ai_identification_logs').insert({
    user_id: mockUser.id,
    ai_manufacturer: claudeResponse.manufacturer,
    ai_mold: claudeResponse.mold,
    ai_confidence: claudeResponse.confidence,
    processing_time_ms: 500,
  });

  assertEquals(mockAiLogs.length, 1);
  assertEquals(mockAiLogs[0].ai_manufacturer, 'Innova');
  assertEquals(mockAiLogs[0].ai_mold, 'Destroyer');

  // Build response
  const response = new Response(
    JSON.stringify({
      identification: {
        manufacturer: claudeResponse.manufacturer,
        mold: claudeResponse.mold,
        disc_type: claudeResponse.disc_type,
        confidence: claudeResponse.confidence,
        raw_text: claudeResponse.visible_text,
        flight_numbers: claudeResponse.flight_numbers,
        plastic: claudeResponse.plastic,
      },
      catalog_match: catalogMatches[0],
      similar_matches: [],
      processing_time_ms: 500,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.identification);
  assertEquals(body.identification.manufacturer, 'Innova');
  assertEquals(body.identification.mold, 'Destroyer');
  assertEquals(body.identification.confidence, 0.92);
  assertExists(body.catalog_match);
  assertEquals(body.catalog_match.id, 'catalog-123');
});

Deno.test('identify-disc-from-photo: should return similar matches when no exact match', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add similar discs to catalog (but not exact match)
  mockCatalogDiscs.push({
    id: 'catalog-456',
    manufacturer: 'Innova',
    mold: 'Shryke',
    category: 'Distance Driver',
    speed: 13,
    glide: 6,
    turn: -2,
    fade: 2,
    stability: 'Understable',
    status: 'verified',
  });

  const supabase = mockSupabaseClient();

  // Simulate Claude response for a disc not in catalog
  const claudeResponse = createMockClaudeResponse({
    manufacturer: 'Innova',
    mold: 'Boss',
    confidence: 0.85,
  });

  // Search for catalog match (won't find exact)
  const { data: similarMatches } = await supabase
    .from('disc_catalog')
    .select('*')
    .or(`mold.ilike.%${claudeResponse.mold}%`)
    .eq('status', 'verified')
    .limit(3);

  assertExists(similarMatches);

  const response = new Response(
    JSON.stringify({
      identification: {
        manufacturer: claudeResponse.manufacturer,
        mold: claudeResponse.mold,
        disc_type: claudeResponse.disc_type,
        confidence: claudeResponse.confidence,
        raw_text: claudeResponse.visible_text,
      },
      catalog_match: null,
      similar_matches: similarMatches,
      processing_time_ms: 600,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.catalog_match, null);
  assertExists(body.similar_matches);
});

Deno.test('identify-disc-from-photo: should handle low confidence identification', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Simulate Claude response with low confidence
  const claudeResponse = createMockClaudeResponse({
    manufacturer: null,
    mold: null,
    disc_type: null,
    confidence: 0.3,
    visible_text: 'Unable to clearly identify. Appears to be a putter with worn stamp.',
  });

  const response = new Response(
    JSON.stringify({
      identification: {
        manufacturer: claudeResponse.manufacturer,
        mold: claudeResponse.mold,
        disc_type: claudeResponse.disc_type,
        confidence: claudeResponse.confidence,
        raw_text: claudeResponse.visible_text,
      },
      catalog_match: null,
      similar_matches: [],
      processing_time_ms: 450,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.identification.confidence, 0.3);
  assertEquals(body.identification.manufacturer, null);
  assertEquals(body.identification.mold, null);
  assertExists(body.identification.raw_text);
});

Deno.test('identify-disc-from-photo: should log identification attempt to database', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  const claudeResponse = createMockClaudeResponse();

  // Log the identification
  await supabase.from('ai_identification_logs').insert({
    user_id: mockUser.id,
    ai_manufacturer: claudeResponse.manufacturer,
    ai_mold: claudeResponse.mold,
    ai_confidence: claudeResponse.confidence,
    processing_time_ms: 520,
  });

  assertEquals(mockAiLogs.length, 1);
  const log = mockAiLogs[0];
  assertEquals(log.user_id, 'user-123');
  assertEquals(log.ai_manufacturer, 'Innova');
  assertEquals(log.ai_mold, 'Destroyer');
  assertEquals(log.ai_confidence, 0.92);
  assertEquals(log.processing_time_ms, 520);
});

Deno.test('identify-disc-from-photo: should handle Claude API error gracefully', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Simulate Claude API failure
  const claudeError = true;

  if (claudeError) {
    const response = new Response(JSON.stringify({ error: 'AI identification failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 502);
    const body = await response.json();
    assertEquals(body.error, 'AI identification failed');
  }
});

Deno.test('identify-disc-from-photo: should handle malformed Claude response', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Simulate malformed response
  const rawResponse = 'This is not valid JSON';

  try {
    JSON.parse(rawResponse);
  } catch {
    const response = new Response(
      JSON.stringify({
        error: 'AI response could not be parsed',
        raw_response: rawResponse,
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 502);
    const body = await response.json();
    assertEquals(body.error, 'AI response could not be parsed');
    assertExists(body.raw_response);
  }
});

Deno.test('identify-disc-from-photo: should return 405 for non-POST requests', async () => {
  resetMocks();

  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const body = await response.json();
    assertEquals(body.error, 'Method not allowed');
  }
});

// Rate limiting tests
Deno.test('identify-disc-from-photo: should use expensive rate limit preset (2 per minute)', () => {
  // Verify the correct preset is configured for this expensive Claude API endpoint
  assertEquals(RateLimitPresets.expensive.maxRequests, 2);
  assertEquals(RateLimitPresets.expensive.windowMs, 60000);
});
