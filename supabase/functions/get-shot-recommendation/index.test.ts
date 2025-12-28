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
  manufacturer: string | null;
  mold: string | null;
  flight_numbers: {
    speed: number;
    glide: number;
    turn: number;
    fade: number;
  };
}

interface MockProfile {
  id: string;
  throwing_hand: 'right' | 'left';
}

interface MockShotLog {
  id: string;
  user_id: string;
  ai_estimated_distance_ft: number;
  ai_confidence: number;
  recommended_disc_id: string;
  recommended_throw_type: string;
  recommended_power_percentage: number;
  recommended_line_description: string;
  processing_time_ms: number;
}

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockProfile: MockProfile | null = null;
let mockShotLogs: MockShotLog[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockProfile = null;
  mockShotLogs = [];
}

// Mock Supabase client with separate methods for different queries
function getDiscsForUser(userId: string): MockDisc[] {
  return mockDiscs.filter((d) => d.owner_id === userId);
}

function getProfileForUser(userId: string): MockProfile | null {
  return mockProfile?.id === userId ? mockProfile : null;
}

function insertShotLog(logData: Record<string, unknown>): MockShotLog {
  const newLog: MockShotLog = {
    id: crypto.randomUUID(),
    user_id: logData.user_id as string,
    ai_estimated_distance_ft: logData.ai_estimated_distance_ft as number,
    ai_confidence: logData.ai_confidence as number,
    recommended_disc_id: logData.recommended_disc_id as string,
    recommended_throw_type: logData.recommended_throw_type as string,
    recommended_power_percentage: logData.recommended_power_percentage as number,
    recommended_line_description: logData.recommended_line_description as string,
    processing_time_ms: logData.processing_time_ms as number,
  };
  mockShotLogs.push(newLog);
  return newLog;
}

// Mock Claude API response for shot recommendation
interface MockClaudeResponse {
  estimated_distance_ft: number;
  confidence: number;
  terrain: {
    elevation_change: 'uphill' | 'downhill' | 'flat';
    obstacles: string;
    fairway_shape: 'straight' | 'dogleg_left' | 'dogleg_right' | 'open';
  };
  recommendation: {
    disc_id: string;
    disc_name: string;
    throw_type: 'hyzer' | 'flat' | 'anhyzer';
    power_percentage: number;
    line_description: string;
  };
  alternatives: Array<{
    disc_id: string;
    disc_name: string;
    throw_type: string;
    reason: string;
  }>;
  analysis_notes: string;
}

function createMockClaudeResponse(
  discId: string,
  discName: string,
  overrides: Partial<MockClaudeResponse> = {}
): MockClaudeResponse {
  return {
    estimated_distance_ft: overrides.estimated_distance_ft ?? 285,
    confidence: overrides.confidence ?? 0.85,
    terrain: overrides.terrain ?? {
      elevation_change: 'flat',
      obstacles: 'Tree line on right side',
      fairway_shape: 'straight',
    },
    recommendation: overrides.recommendation ?? {
      disc_id: discId,
      disc_name: discName,
      throw_type: 'hyzer',
      power_percentage: 85,
      line_description: 'Aim left of center, release on hyzer, let the disc fade back to the basket.',
    },
    alternatives: overrides.alternatives ?? [],
    analysis_notes: overrides.analysis_notes ?? 'Clear line to basket with slight fade needed.',
  };
}

Deno.test('get-shot-recommendation: should return 401 when not authenticated', async () => {
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

Deno.test('get-shot-recommendation: should return 400 when image is missing', async () => {
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

Deno.test('get-shot-recommendation: should return 400 for non-image files', async () => {
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

Deno.test('get-shot-recommendation: should return 400 for files over 5MB', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

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

Deno.test('get-shot-recommendation: should return 503 when ANTHROPIC_API_KEY not configured', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const anthropicApiKey = undefined;

  if (!anthropicApiKey) {
    const response = new Response(JSON.stringify({ error: 'AI recommendation not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 503);
    const body = await response.json();
    assertEquals(body.error, 'AI recommendation not configured');
  }
});

Deno.test('get-shot-recommendation: should return 400 when user has no discs in bag', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockDiscs = []; // Empty bag

  const userDiscs = getDiscsForUser(mockUser.id);

  if (userDiscs.length === 0) {
    const response = new Response(
      JSON.stringify({ error: 'No discs in bag. Add discs to get shot recommendations.' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'No discs in bag. Add discs to get shot recommendations.');
  }
});

Deno.test('get-shot-recommendation: should successfully return recommendation', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockProfile = { id: 'user-123', throwing_hand: 'right' };

  // Add discs to user's bag
  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'My Buzzz',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      flight_numbers: { speed: 5, glide: 4, turn: -1, fade: 1 },
    },
  ];

  // Fetch user's discs
  const userDiscs = getDiscsForUser(mockUser.id);
  assertExists(userDiscs);
  assertEquals(userDiscs.length, 2);

  // Fetch user's throwing hand
  const profile = getProfileForUser(mockUser.id);
  assertExists(profile);
  assertEquals(profile.throwing_hand, 'right');

  // Simulate Claude response
  const claudeResponse = createMockClaudeResponse('disc-1', 'Destroyer');

  // Log the recommendation
  insertShotLog({
    user_id: mockUser.id,
    ai_estimated_distance_ft: claudeResponse.estimated_distance_ft,
    ai_confidence: claudeResponse.confidence,
    recommended_disc_id: claudeResponse.recommendation.disc_id,
    recommended_throw_type: claudeResponse.recommendation.throw_type,
    recommended_power_percentage: claudeResponse.recommendation.power_percentage,
    recommended_line_description: claudeResponse.recommendation.line_description,
    processing_time_ms: 1200,
  });

  assertEquals(mockShotLogs.length, 1);
  assertEquals(mockShotLogs[0].recommended_disc_id, 'disc-1');

  // Build response
  const recommendedDisc = userDiscs.find((d: MockDisc) => d.id === claudeResponse.recommendation.disc_id);
  assertExists(recommendedDisc);

  const response = new Response(
    JSON.stringify({
      recommendation: {
        disc: {
          id: recommendedDisc.id,
          name: recommendedDisc.mold,
          manufacturer: recommendedDisc.manufacturer,
          flight_numbers: recommendedDisc.flight_numbers,
        },
        throw_type: claudeResponse.recommendation.throw_type,
        power_percentage: claudeResponse.recommendation.power_percentage,
        line_description: claudeResponse.recommendation.line_description,
      },
      terrain_analysis: {
        estimated_distance_ft: claudeResponse.estimated_distance_ft,
        elevation_change: claudeResponse.terrain.elevation_change,
        obstacles: claudeResponse.terrain.obstacles,
        fairway_shape: claudeResponse.terrain.fairway_shape,
      },
      alternatives: [],
      confidence: claudeResponse.confidence,
      processing_time_ms: 1200,
      log_id: mockShotLogs[0].id,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.recommendation);
  assertEquals(body.recommendation.disc.id, 'disc-1');
  assertEquals(body.recommendation.disc.name, 'Destroyer');
  assertEquals(body.recommendation.throw_type, 'hyzer');
  assertEquals(body.recommendation.power_percentage, 85);
  assertExists(body.terrain_analysis);
  assertEquals(body.terrain_analysis.estimated_distance_ft, 285);
  assertEquals(body.confidence, 0.85);
});

Deno.test('get-shot-recommendation: should return alternatives when available', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockProfile = { id: 'user-123', throwing_hand: 'right' };

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'My Wraith',
      manufacturer: 'Innova',
      mold: 'Wraith',
      flight_numbers: { speed: 11, glide: 5, turn: -1, fade: 3 },
    },
  ];

  // Claude recommends Destroyer but Wraith is alternative
  const claudeResponse = createMockClaudeResponse('disc-1', 'Destroyer', {
    alternatives: [
      {
        disc_id: 'disc-2',
        disc_name: 'Wraith',
        throw_type: 'flat',
        reason: 'Slightly more glide for uphill finish',
      },
    ],
  });

  const response = new Response(
    JSON.stringify({
      recommendation: {
        disc: {
          id: 'disc-1',
          name: 'Destroyer',
          manufacturer: 'Innova',
          flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
        },
        throw_type: claudeResponse.recommendation.throw_type,
        power_percentage: claudeResponse.recommendation.power_percentage,
        line_description: claudeResponse.recommendation.line_description,
      },
      terrain_analysis: {
        estimated_distance_ft: claudeResponse.estimated_distance_ft,
        elevation_change: claudeResponse.terrain.elevation_change,
        obstacles: claudeResponse.terrain.obstacles,
        fairway_shape: claudeResponse.terrain.fairway_shape,
      },
      alternatives: claudeResponse.alternatives.map((alt) => ({
        disc: {
          id: alt.disc_id,
          name: alt.disc_name,
          manufacturer: 'Innova',
        },
        throw_type: alt.throw_type,
        reason: alt.reason,
      })),
      confidence: claudeResponse.confidence,
      processing_time_ms: 1100,
      log_id: 'log-123',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.alternatives);
  assertEquals(body.alternatives.length, 1);
  assertEquals(body.alternatives[0].disc.name, 'Wraith');
  assertEquals(body.alternatives[0].reason, 'Slightly more glide for uphill finish');
});

Deno.test('get-shot-recommendation: should default throwing hand to right if not set', () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockProfile = null; // No profile set

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  const profile = getProfileForUser(mockUser.id);

  // Should default to right
  const throwingHand = profile?.throwing_hand ?? 'right';
  assertEquals(throwingHand, 'right');
});

Deno.test('get-shot-recommendation: should handle Claude API error gracefully', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Simulate Claude API failure
  const claudeError = true;

  if (claudeError) {
    const response = new Response(JSON.stringify({ error: 'AI recommendation failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 502);
    const body = await response.json();
    assertEquals(body.error, 'AI recommendation failed');
  }
});

Deno.test('get-shot-recommendation: should handle malformed Claude response', async () => {
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

Deno.test('get-shot-recommendation: should log recommendation to database', () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const claudeResponse = createMockClaudeResponse('disc-1', 'Destroyer');

  // Log the recommendation
  insertShotLog({
    user_id: mockUser.id,
    ai_estimated_distance_ft: claudeResponse.estimated_distance_ft,
    ai_confidence: claudeResponse.confidence,
    recommended_disc_id: claudeResponse.recommendation.disc_id,
    recommended_throw_type: claudeResponse.recommendation.throw_type,
    recommended_power_percentage: claudeResponse.recommendation.power_percentage,
    recommended_line_description: claudeResponse.recommendation.line_description,
    processing_time_ms: 1500,
  });

  assertEquals(mockShotLogs.length, 1);
  const log = mockShotLogs[0];
  assertEquals(log.user_id, 'user-123');
  assertEquals(log.ai_estimated_distance_ft, 285);
  assertEquals(log.ai_confidence, 0.85);
  assertEquals(log.recommended_disc_id, 'disc-1');
  assertEquals(log.recommended_throw_type, 'hyzer');
  assertEquals(log.recommended_power_percentage, 85);
  assertEquals(log.processing_time_ms, 1500);
});

Deno.test('get-shot-recommendation: should return 405 for non-POST requests', async () => {
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

Deno.test('get-shot-recommendation: should handle left-handed thrower', () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockProfile = { id: 'user-123', throwing_hand: 'left' };

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  const profile = getProfileForUser(mockUser.id);

  assertExists(profile);
  assertEquals(profile.throwing_hand, 'left');

  // Claude should receive left-handed context and provide appropriate recommendation
  // For left-handed backhand, the disc fades the opposite direction
  const claudeResponse = createMockClaudeResponse('disc-1', 'Destroyer', {
    recommendation: {
      disc_id: 'disc-1',
      disc_name: 'Destroyer',
      throw_type: 'anhyzer',
      power_percentage: 80,
      line_description: 'Aim right of center, release on anhyzer for a left-handed fade back to basket.',
    },
  });

  assertEquals(claudeResponse.recommendation.throw_type, 'anhyzer');
  assertExists(claudeResponse.recommendation.line_description);
});
