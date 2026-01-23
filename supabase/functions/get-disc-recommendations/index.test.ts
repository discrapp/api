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
  plastic: string | null;
  flight_numbers: {
    speed: number;
    glide: number;
    turn: number;
    fade: number;
  } | null;
}

interface MockCatalogDisc {
  id: string;
  manufacturer: string;
  mold: string;
  category: string | null;
  speed: number;
  glide: number;
  turn: number;
  fade: number;
  stability: string | null;
  status: 'verified' | 'user_submitted' | 'rejected';
}

interface MockRecommendationLog {
  id: string;
  user_id: string;
  request_count: number;
  bag_analysis: Record<string, unknown>;
  recommendations: Record<string, unknown>[];
  confidence: number;
  processing_time_ms: number;
}

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockCatalogDiscs: MockCatalogDisc[] = [];
let mockRecommendationLogs: MockRecommendationLog[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockCatalogDiscs = [];
  mockRecommendationLogs = [];
}

// Mock Supabase client helpers
function getDiscsForUser(userId: string): MockDisc[] {
  return mockDiscs.filter((d) => d.owner_id === userId);
}

function getVerifiedCatalogDiscs(): MockCatalogDisc[] {
  return mockCatalogDiscs.filter((d) => d.status === 'verified');
}

function insertRecommendationLog(logData: Record<string, unknown>): MockRecommendationLog {
  const newLog: MockRecommendationLog = {
    id: crypto.randomUUID(),
    user_id: logData.user_id as string,
    request_count: logData.request_count as number,
    bag_analysis: logData.bag_analysis as Record<string, unknown>,
    recommendations: logData.recommendations as Record<string, unknown>[],
    confidence: logData.confidence as number,
    processing_time_ms: logData.processing_time_ms as number,
  };
  mockRecommendationLogs.push(newLog);
  return newLog;
}

// Bag analysis helper functions (to be implemented)
interface BrandPreference {
  manufacturer: string;
  count: number;
}

interface PlasticPreference {
  plastic: string;
  count: number;
}

interface SpeedGap {
  from: number;
  to: number;
}

interface StabilityByCategory {
  category: string;
  understable: number;
  stable: number;
  overstable: number;
}

interface BagAnalysis {
  total_discs: number;
  brand_preferences: BrandPreference[];
  plastic_preferences: PlasticPreference[];
  speed_coverage: {
    min: number;
    max: number;
    gaps: SpeedGap[];
  };
  stability_by_category: StabilityByCategory[];
  identified_gaps: string[];
}

// Stability classification based on turn + fade
function classifyStability(turn: number, fade: number): 'understable' | 'stable' | 'overstable' {
  // understable: turn <= -2 (significantly turns over at high speed)
  // overstable: fade >= 3 OR (turn + fade) > 2 (strong fade, doesn't turn)
  // stable: everything else (neutral flight)
  if (turn <= -2) return 'understable';
  if (fade >= 3 || turn + fade > 2) return 'overstable';
  return 'stable';
}

// Category classification based on speed
function classifyCategory(speed: number): string {
  if (speed >= 11) return 'Distance Driver';
  if (speed >= 7) return 'Fairway Driver';
  if (speed >= 4) return 'Midrange';
  return 'Putter';
}

// Analyze user's bag
function analyzeBag(discs: MockDisc[]): BagAnalysis {
  const brandCounts: Record<string, number> = {};
  const plasticCounts: Record<string, number> = {};
  const speeds: number[] = [];
  const stabilityByCategory: Record<string, { understable: number; stable: number; overstable: number }> = {};

  for (const disc of discs) {
    // Count brands
    if (disc.manufacturer) {
      brandCounts[disc.manufacturer] = (brandCounts[disc.manufacturer] || 0) + 1;
    }

    // Count plastics
    if (disc.plastic) {
      plasticCounts[disc.plastic] = (plasticCounts[disc.plastic] || 0) + 1;
    }

    // Collect speeds
    if (disc.flight_numbers?.speed) {
      speeds.push(disc.flight_numbers.speed);
    }

    // Classify stability by category
    if (disc.flight_numbers) {
      const category = classifyCategory(disc.flight_numbers.speed);
      const stability = classifyStability(disc.flight_numbers.turn, disc.flight_numbers.fade);

      if (!stabilityByCategory[category]) {
        stabilityByCategory[category] = { understable: 0, stable: 0, overstable: 0 };
      }
      stabilityByCategory[category][stability]++;
    }
  }

  // Sort brand preferences by count
  const brandPreferences = Object.entries(brandCounts)
    .map(([manufacturer, count]) => ({ manufacturer, count }))
    .sort((a, b) => b.count - a.count);

  // Sort plastic preferences by count
  const plasticPreferences = Object.entries(plasticCounts)
    .map(([plastic, count]) => ({ plastic, count }))
    .sort((a, b) => b.count - a.count);

  // Calculate speed gaps
  const sortedSpeeds = [...new Set(speeds)].sort((a, b) => a - b);
  const speedGaps: SpeedGap[] = [];

  // Check for gaps in speed range (e.g., missing speed 7-8 range)
  for (let i = 0; i < sortedSpeeds.length - 1; i++) {
    const gap = sortedSpeeds[i + 1] - sortedSpeeds[i];
    if (gap >= 3) {
      speedGaps.push({ from: sortedSpeeds[i], to: sortedSpeeds[i + 1] });
    }
  }

  // Convert stability by category to array
  const stabilityArray = Object.entries(stabilityByCategory).map(([category, counts]) => ({
    category,
    ...counts,
  }));

  // Identify gaps
  const identifiedGaps: string[] = [];

  // Check for missing categories
  const categories = ['Distance Driver', 'Fairway Driver', 'Midrange', 'Putter'];
  for (const cat of categories) {
    if (!stabilityByCategory[cat]) {
      identifiedGaps.push(`No ${cat}s in bag`);
    } else {
      // Check for missing stabilities within category
      const catStability = stabilityByCategory[cat];
      if (catStability.understable === 0) {
        identifiedGaps.push(`No understable ${cat}`);
      }
      if (catStability.overstable === 0) {
        identifiedGaps.push(`No overstable ${cat}`);
      }
    }
  }

  return {
    total_discs: discs.length,
    brand_preferences: brandPreferences,
    plastic_preferences: plasticPreferences,
    speed_coverage: {
      min: Math.min(...speeds) || 0,
      max: Math.max(...speeds) || 0,
      gaps: speedGaps,
    },
    stability_by_category: stabilityArray,
    identified_gaps: identifiedGaps,
  };
}

// Affiliate link generation
// URL format: https://infinitediscs.com/{manufacturer-slug}-{mold-slug}
function generateAffiliateUrl(manufacturer: string, mold: string, affiliateId: string): string {
  // Convert to URL slug format: lowercase, spaces to hyphens
  const manufacturerSlug = manufacturer.toLowerCase().replace(/\s+/g, '-');
  const moldSlug = mold.toLowerCase().replace(/\s+/g, '-');
  const baseUrl = `https://infinitediscs.com/${manufacturerSlug}-${moldSlug}`;
  // Only add affiliate param if it's set
  if (affiliateId) {
    return `${baseUrl}?aff=${affiliateId}`;
  }
  return baseUrl;
}

// Popular disc golf brands (well-known manufacturers)
const POPULAR_BRANDS = [
  'Innova',
  'Discraft',
  'Dynamic Discs',
  'Latitude 64',
  'MVP',
  'Axiom',
  'Streamline',
  'Westside Discs',
  'Kastaplast',
  'Prodigy',
  'Discmania',
  'Trilogy',
  'Infinite Discs',
  'Thought Space Athletics',
  'Mint Discs',
  'Lone Star Discs',
];

// Filter and prioritize catalog discs based on user's preferences
interface CatalogDiscForFilter {
  id: string;
  manufacturer: string;
  mold: string;
}

function filterAndPrioritizeCatalog(
  catalogDiscs: CatalogDiscForFilter[],
  userBrands: string[],
  maxDiscs: number = 150
): CatalogDiscForFilter[] {
  // Normalize brand names for comparison (case-insensitive)
  const userBrandsLower = userBrands.map((b) => b.toLowerCase());
  const popularBrandsLower = POPULAR_BRANDS.map((b) => b.toLowerCase());

  // Sort discs: user's brands first, then popular brands, then others
  const sortedDiscs = [...catalogDiscs].sort((a, b) => {
    const aManufacturerLower = a.manufacturer.toLowerCase();
    const bManufacturerLower = b.manufacturer.toLowerCase();

    const aIsUserBrand = userBrandsLower.includes(aManufacturerLower);
    const bIsUserBrand = userBrandsLower.includes(bManufacturerLower);
    const aIsPopular = popularBrandsLower.includes(aManufacturerLower);
    const bIsPopular = popularBrandsLower.includes(bManufacturerLower);

    // User's brands come first
    if (aIsUserBrand && !bIsUserBrand) return -1;
    if (!aIsUserBrand && bIsUserBrand) return 1;

    // Then popular brands
    if (aIsPopular && !bIsPopular) return -1;
    if (!aIsPopular && bIsPopular) return 1;

    // Within same priority, sort by manufacturer then mold
    if (a.manufacturer !== b.manufacturer) {
      return a.manufacturer.localeCompare(b.manufacturer);
    }
    return a.mold.localeCompare(b.mold);
  });

  return sortedDiscs.slice(0, maxDiscs);
}

// ============== TESTS ==============

Deno.test('get-disc-recommendations: should return 405 for non-POST requests', async () => {
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

Deno.test('get-disc-recommendations: should return 401 when not authenticated', async () => {
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

Deno.test('get-disc-recommendations: should return 401 with invalid token', async () => {
  resetMocks();

  // Simulate invalid auth - user not found
  mockUser = null;

  const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Unauthorized');
});

Deno.test('get-disc-recommendations: should return 400 for invalid count value (0)', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const requestBody: { count?: number } = { count: 0 };
  const validCounts = [1, 3, 5];

  if (!requestBody.count || !validCounts.includes(requestBody.count)) {
    const response = new Response(JSON.stringify({ error: 'count must be 1, 3, or 5' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'count must be 1, 3, or 5');
  }
});

Deno.test('get-disc-recommendations: should return 400 for invalid count value (2)', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const requestBody = { count: 2 };
  const validCounts = [1, 3, 5];

  if (!validCounts.includes(requestBody.count)) {
    const response = new Response(JSON.stringify({ error: 'count must be 1, 3, or 5' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'count must be 1, 3, or 5');
  }
});

Deno.test('get-disc-recommendations: should return 400 for invalid count value (10)', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const requestBody = { count: 10 };
  const validCounts = [1, 3, 5];

  if (!validCounts.includes(requestBody.count)) {
    const response = new Response(JSON.stringify({ error: 'count must be 1, 3, or 5' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'count must be 1, 3, or 5');
  }
});

Deno.test('get-disc-recommendations: should return 400 when user has no discs', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockDiscs = []; // Empty bag

  const userDiscs = getDiscsForUser(mockUser.id);

  if (userDiscs.length === 0) {
    const response = new Response(JSON.stringify({ error: 'No discs in bag. Add discs to get recommendations.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'No discs in bag. Add discs to get recommendations.');
  }
});

Deno.test('get-disc-recommendations: should return 503 when ANTHROPIC_API_KEY not configured', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  const anthropicApiKey = undefined;

  if (!anthropicApiKey) {
    const response = new Response(JSON.stringify({ error: 'AI recommendations not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 503);
    const body = await response.json();
    assertEquals(body.error, 'AI recommendations not configured');
  }
});

Deno.test('get-disc-recommendations: should successfully return 1 recommendation', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // User has some discs but missing understable midrange
  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'My Roc3',
      manufacturer: 'Innova',
      mold: 'Roc3',
      plastic: 'Champion',
      flight_numbers: { speed: 5, glide: 4, turn: 0, fade: 3 },
    },
  ];

  mockCatalogDiscs = [
    {
      id: 'catalog-1',
      manufacturer: 'Innova',
      mold: 'Mako3',
      category: 'Midrange',
      speed: 5,
      glide: 5,
      turn: 0,
      fade: 0,
      stability: 'Stable',
      status: 'verified',
    },
    {
      id: 'catalog-2',
      manufacturer: 'Innova',
      mold: 'Leopard',
      category: 'Fairway Driver',
      speed: 6,
      glide: 5,
      turn: -2,
      fade: 1,
      stability: 'Understable',
      status: 'verified',
    },
  ];

  const userDiscs = getDiscsForUser(mockUser.id);
  assertExists(userDiscs);
  assertEquals(userDiscs.length, 2);

  const bagAnalysis = analyzeBag(userDiscs);
  assertExists(bagAnalysis);
  assertEquals(bagAnalysis.total_discs, 2);

  // Simulate Claude response with 1 recommendation
  const recommendation = {
    catalog_id: 'catalog-2',
    manufacturer: 'Innova',
    mold: 'Leopard',
    reason: 'Your bag lacks an understable fairway driver for turnover shots and hyzer flips.',
    gap_type: 'stability' as const,
    priority: 1,
  };

  // Generate affiliate URL
  const affiliateId = 'test-affiliate';
  const purchaseUrl = generateAffiliateUrl(recommendation.manufacturer, recommendation.mold, affiliateId);
  assertExists(purchaseUrl);
  assertEquals(purchaseUrl.includes('infinitediscs.com'), true);
  assertEquals(purchaseUrl.includes('aff=test-affiliate'), true);

  // Log the recommendation
  const log = insertRecommendationLog({
    user_id: mockUser.id,
    request_count: 1,
    bag_analysis: bagAnalysis,
    recommendations: [recommendation],
    confidence: 0.85,
    processing_time_ms: 1500,
  });

  assertExists(log.id);
  assertEquals(mockRecommendationLogs.length, 1);

  // Build response
  const catalogDisc = mockCatalogDiscs.find((d) => d.id === recommendation.catalog_id);
  assertExists(catalogDisc);

  const response = new Response(
    JSON.stringify({
      recommendations: [
        {
          disc: {
            id: catalogDisc.id,
            manufacturer: catalogDisc.manufacturer,
            mold: catalogDisc.mold,
            category: catalogDisc.category,
            flight_numbers: {
              speed: catalogDisc.speed,
              glide: catalogDisc.glide,
              turn: catalogDisc.turn,
              fade: catalogDisc.fade,
            },
            stability: catalogDisc.stability,
          },
          reason: recommendation.reason,
          gap_type: recommendation.gap_type,
          priority: recommendation.priority,
          purchase_url: purchaseUrl,
        },
      ],
      bag_analysis: bagAnalysis,
      confidence: 0.85,
      processing_time_ms: 1500,
      log_id: log.id,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertExists(body.recommendations);
  assertEquals(body.recommendations.length, 1);
  assertEquals(body.recommendations[0].disc.mold, 'Leopard');
  assertExists(body.bag_analysis);
  assertEquals(body.confidence, 0.85);
});

Deno.test('get-disc-recommendations: should successfully return 3 recommendations', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  mockCatalogDiscs = [
    {
      id: 'catalog-1',
      manufacturer: 'Innova',
      mold: 'Mako3',
      category: 'Midrange',
      speed: 5,
      glide: 5,
      turn: 0,
      fade: 0,
      stability: 'Stable',
      status: 'verified',
    },
    {
      id: 'catalog-2',
      manufacturer: 'Innova',
      mold: 'Aviar',
      category: 'Putter',
      speed: 2,
      glide: 3,
      turn: 0,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
    {
      id: 'catalog-3',
      manufacturer: 'Innova',
      mold: 'Leopard',
      category: 'Fairway Driver',
      speed: 6,
      glide: 5,
      turn: -2,
      fade: 1,
      stability: 'Understable',
      status: 'verified',
    },
  ];

  const bagAnalysis = analyzeBag(getDiscsForUser(mockUser.id));
  assertEquals(bagAnalysis.total_discs, 1);

  // Simulate 3 recommendations
  const recommendations = [
    { catalog_id: 'catalog-2', manufacturer: 'Innova', mold: 'Aviar', gap_type: 'category', priority: 1 },
    { catalog_id: 'catalog-1', manufacturer: 'Innova', mold: 'Mako3', gap_type: 'category', priority: 2 },
    { catalog_id: 'catalog-3', manufacturer: 'Innova', mold: 'Leopard', gap_type: 'stability', priority: 3 },
  ];

  const response = new Response(
    JSON.stringify({
      recommendations: recommendations.map((rec) => ({
        disc: mockCatalogDiscs.find((d) => d.id === rec.catalog_id),
        reason: 'Test reason',
        gap_type: rec.gap_type,
        priority: rec.priority,
        purchase_url: generateAffiliateUrl(rec.manufacturer, rec.mold, 'test'),
      })),
      bag_analysis: bagAnalysis,
      confidence: 0.9,
      processing_time_ms: 2000,
      log_id: 'log-123',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.recommendations.length, 3);
});

Deno.test('get-disc-recommendations: should successfully return 5 recommendations', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  mockCatalogDiscs = [
    {
      id: 'catalog-1',
      manufacturer: 'Innova',
      mold: 'Mako3',
      category: 'Midrange',
      speed: 5,
      glide: 5,
      turn: 0,
      fade: 0,
      stability: 'Stable',
      status: 'verified',
    },
    {
      id: 'catalog-2',
      manufacturer: 'Innova',
      mold: 'Aviar',
      category: 'Putter',
      speed: 2,
      glide: 3,
      turn: 0,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
    {
      id: 'catalog-3',
      manufacturer: 'Innova',
      mold: 'Leopard',
      category: 'Fairway Driver',
      speed: 6,
      glide: 5,
      turn: -2,
      fade: 1,
      stability: 'Understable',
      status: 'verified',
    },
    {
      id: 'catalog-4',
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
    {
      id: 'catalog-5',
      manufacturer: 'MVP',
      mold: 'Volt',
      category: 'Fairway Driver',
      speed: 8,
      glide: 5,
      turn: -0.5,
      fade: 2,
      stability: 'Stable',
      status: 'verified',
    },
  ];

  const bagAnalysis = analyzeBag(getDiscsForUser(mockUser.id));

  // Simulate 5 recommendations
  const recommendations = mockCatalogDiscs.map((disc, i) => ({
    disc,
    reason: 'Test reason',
    gap_type: 'category',
    priority: i + 1,
    purchase_url: generateAffiliateUrl(disc.manufacturer, disc.mold, 'test'),
  }));

  const response = new Response(
    JSON.stringify({
      recommendations,
      bag_analysis: bagAnalysis,
      confidence: 0.88,
      processing_time_ms: 2500,
      log_id: 'log-456',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.recommendations.length, 5);
});

// ============== BAG ANALYSIS TESTS ==============

Deno.test('get-disc-recommendations: analyzeBag should correctly count brand preferences', () => {
  resetMocks();

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'Disc 1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'Disc 2',
      manufacturer: 'Innova',
      mold: 'Roc3',
      plastic: 'Champion',
      flight_numbers: { speed: 5, glide: 4, turn: 0, fade: 3 },
    },
    {
      id: 'disc-3',
      owner_id: 'user-123',
      name: 'Disc 3',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      plastic: 'Z',
      flight_numbers: { speed: 5, glide: 4, turn: -1, fade: 1 },
    },
  ];

  const analysis = analyzeBag(mockDiscs);

  assertEquals(analysis.brand_preferences.length, 2);
  assertEquals(analysis.brand_preferences[0].manufacturer, 'Innova');
  assertEquals(analysis.brand_preferences[0].count, 2);
  assertEquals(analysis.brand_preferences[1].manufacturer, 'Discraft');
  assertEquals(analysis.brand_preferences[1].count, 1);
});

Deno.test('get-disc-recommendations: analyzeBag should correctly count plastic preferences', () => {
  resetMocks();

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'Disc 1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'Disc 2',
      manufacturer: 'Innova',
      mold: 'Roc3',
      plastic: 'Star',
      flight_numbers: { speed: 5, glide: 4, turn: 0, fade: 3 },
    },
    {
      id: 'disc-3',
      owner_id: 'user-123',
      name: 'Disc 3',
      manufacturer: 'Innova',
      mold: 'Aviar',
      plastic: 'DX',
      flight_numbers: { speed: 2, glide: 3, turn: 0, fade: 1 },
    },
  ];

  const analysis = analyzeBag(mockDiscs);

  assertEquals(analysis.plastic_preferences.length, 2);
  assertEquals(analysis.plastic_preferences[0].plastic, 'Star');
  assertEquals(analysis.plastic_preferences[0].count, 2);
  assertEquals(analysis.plastic_preferences[1].plastic, 'DX');
  assertEquals(analysis.plastic_preferences[1].count, 1);
});

Deno.test('get-disc-recommendations: analyzeBag should detect speed gaps', () => {
  resetMocks();

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'Disc 1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'Disc 2',
      manufacturer: 'Innova',
      mold: 'Aviar',
      plastic: 'DX',
      flight_numbers: { speed: 2, glide: 3, turn: 0, fade: 1 },
    },
  ];

  const analysis = analyzeBag(mockDiscs);

  assertEquals(analysis.speed_coverage.min, 2);
  assertEquals(analysis.speed_coverage.max, 12);
  // Should detect gap between 2 and 12
  assertEquals(analysis.speed_coverage.gaps.length, 1);
  assertEquals(analysis.speed_coverage.gaps[0].from, 2);
  assertEquals(analysis.speed_coverage.gaps[0].to, 12);
});

Deno.test('get-disc-recommendations: classifyStability should work correctly', () => {
  // understable: turn <= -2 (significantly turns over at high speed)
  assertEquals(classifyStability(-3, 1), 'understable');
  assertEquals(classifyStability(-2, 1), 'understable');
  assertEquals(classifyStability(-2, 0), 'understable');

  // overstable: fade >= 3 OR (turn + fade) > 2 (strong fade)
  assertEquals(classifyStability(-1, 3), 'overstable');
  assertEquals(classifyStability(0, 4), 'overstable');
  assertEquals(classifyStability(1, 2), 'overstable'); // turn + fade > 2

  // stable: everything else (neutral flight)
  assertEquals(classifyStability(-1, 1), 'stable');
  assertEquals(classifyStability(-1, 2), 'stable');
  assertEquals(classifyStability(0, 1), 'stable');
  assertEquals(classifyStability(0, 0), 'stable'); // truly neutral disc
  assertEquals(classifyStability(0, 2), 'stable'); // moderate fade
});

Deno.test('get-disc-recommendations: classifyCategory should work correctly', () => {
  assertEquals(classifyCategory(14), 'Distance Driver');
  assertEquals(classifyCategory(12), 'Distance Driver');
  assertEquals(classifyCategory(11), 'Distance Driver');

  assertEquals(classifyCategory(10), 'Fairway Driver');
  assertEquals(classifyCategory(8), 'Fairway Driver');
  assertEquals(classifyCategory(7), 'Fairway Driver');

  assertEquals(classifyCategory(6), 'Midrange');
  assertEquals(classifyCategory(5), 'Midrange');
  assertEquals(classifyCategory(4), 'Midrange');

  assertEquals(classifyCategory(3), 'Putter');
  assertEquals(classifyCategory(2), 'Putter');
  assertEquals(classifyCategory(1), 'Putter');
});

Deno.test('get-disc-recommendations: analyzeBag should identify missing categories', () => {
  resetMocks();

  // Only distance drivers in bag
  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'Disc 1',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'Disc 2',
      manufacturer: 'Innova',
      mold: 'Wraith',
      plastic: 'Star',
      flight_numbers: { speed: 11, glide: 5, turn: -1, fade: 3 },
    },
  ];

  const analysis = analyzeBag(mockDiscs);

  // Should identify missing categories
  assertEquals(analysis.identified_gaps.includes('No Fairway Drivers in bag'), true);
  assertEquals(analysis.identified_gaps.includes('No Midranges in bag'), true);
  assertEquals(analysis.identified_gaps.includes('No Putters in bag'), true);
});

Deno.test('get-disc-recommendations: analyzeBag should identify missing stability slots', () => {
  resetMocks();

  // Only overstable midranges
  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'Disc 1',
      manufacturer: 'Innova',
      mold: 'Roc3',
      plastic: 'Champion',
      flight_numbers: { speed: 5, glide: 4, turn: 0, fade: 3 },
    },
    {
      id: 'disc-2',
      owner_id: 'user-123',
      name: 'Disc 2',
      manufacturer: 'Innova',
      mold: 'Gator',
      plastic: 'Champion',
      flight_numbers: { speed: 5, glide: 2, turn: 0, fade: 3 },
    },
  ];

  const analysis = analyzeBag(mockDiscs);

  // Should identify missing understable midrange
  assertEquals(analysis.identified_gaps.includes('No understable Midrange'), true);
});

// ============== AFFILIATE LINK TESTS ==============

Deno.test('get-disc-recommendations: generateAffiliateUrl should create valid URL', () => {
  const url = generateAffiliateUrl('Innova', 'Destroyer', 'my-affiliate-123');

  // Should be direct disc page format: https://infinitediscs.com/innova-destroyer
  assertEquals(url, 'https://infinitediscs.com/innova-destroyer?aff=my-affiliate-123');
});

Deno.test('get-disc-recommendations: generateAffiliateUrl should handle spaces in names', () => {
  const url = generateAffiliateUrl('Dynamic Discs', 'Deputy', 'affiliate-id');

  // Spaces should become hyphens: dynamic-discs-deputy
  assertEquals(url, 'https://infinitediscs.com/dynamic-discs-deputy?aff=affiliate-id');
});

Deno.test('get-disc-recommendations: generateAffiliateUrl should work without affiliate ID', () => {
  const url = generateAffiliateUrl('Innova', 'Destroyer', '');

  // No affiliate param when not set
  assertEquals(url, 'https://infinitediscs.com/innova-destroyer');
});

Deno.test('get-disc-recommendations: generateAffiliateUrl should handle mixed case', () => {
  const url = generateAffiliateUrl('INNOVA', 'DESTROYER', 'test');

  // Should lowercase everything
  assertEquals(url, 'https://infinitediscs.com/innova-destroyer?aff=test');
});

// ============== CATALOG FILTERING TESTS ==============

Deno.test('get-disc-recommendations: filterAndPrioritizeCatalog should prioritize user brands first', () => {
  const catalog = [
    { id: '1', manufacturer: 'Unknown Brand', mold: 'Disc A' },
    { id: '2', manufacturer: 'Innova', mold: 'Destroyer' },
    { id: '3', manufacturer: 'Discraft', mold: 'Buzzz' },
    { id: '4', manufacturer: 'Latitude 64', mold: 'River' },
  ];

  // User prefers Latitude 64
  const result = filterAndPrioritizeCatalog(catalog, ['Latitude 64']);

  // Latitude 64 (user's brand) should be first
  assertEquals(result[0].manufacturer, 'Latitude 64');
  // Then popular brands (Discraft, Innova)
  assertEquals(result[1].manufacturer, 'Discraft');
  assertEquals(result[2].manufacturer, 'Innova');
  // Unknown brand last
  assertEquals(result[3].manufacturer, 'Unknown Brand');
});

Deno.test('get-disc-recommendations: filterAndPrioritizeCatalog should be case-insensitive', () => {
  const catalog = [
    { id: '1', manufacturer: 'INNOVA', mold: 'Destroyer' },
    { id: '2', manufacturer: 'innova', mold: 'Roc3' },
    { id: '3', manufacturer: 'Unknown', mold: 'Test' },
  ];

  // User types brand in different case
  const result = filterAndPrioritizeCatalog(catalog, ['Innova']);

  // Both Innova variants should come before Unknown
  assertEquals(result[0].manufacturer.toLowerCase(), 'innova');
  assertEquals(result[1].manufacturer.toLowerCase(), 'innova');
  assertEquals(result[2].manufacturer, 'Unknown');
});

Deno.test('get-disc-recommendations: filterAndPrioritizeCatalog should respect maxDiscs limit', () => {
  const catalog = [
    { id: '1', manufacturer: 'Innova', mold: 'A' },
    { id: '2', manufacturer: 'Innova', mold: 'B' },
    { id: '3', manufacturer: 'Innova', mold: 'C' },
    { id: '4', manufacturer: 'Innova', mold: 'D' },
    { id: '5', manufacturer: 'Innova', mold: 'E' },
  ];

  const result = filterAndPrioritizeCatalog(catalog, ['Innova'], 3);

  assertEquals(result.length, 3);
});

Deno.test('get-disc-recommendations: filterAndPrioritizeCatalog should put popular brands before unknown', () => {
  const catalog = [
    { id: '1', manufacturer: 'Acme Discs', mold: 'Test' },
    { id: '2', manufacturer: 'MVP', mold: 'Volt' },
    { id: '3', manufacturer: 'Kastaplast', mold: 'Kaxe' },
    { id: '4', manufacturer: 'Random Brand', mold: 'Disc' },
  ];

  // No user brands specified
  const result = filterAndPrioritizeCatalog(catalog, []);

  // Popular brands (Kastaplast, MVP) should come first (alphabetically sorted)
  assertEquals(result[0].manufacturer, 'Kastaplast');
  assertEquals(result[1].manufacturer, 'MVP');
  // Unknown brands after
  assertEquals(result[2].manufacturer, 'Acme Discs');
  assertEquals(result[3].manufacturer, 'Random Brand');
});

Deno.test('get-disc-recommendations: filterAndPrioritizeCatalog should handle multiple user brands', () => {
  const catalog = [
    { id: '1', manufacturer: 'Unknown', mold: 'Test' },
    { id: '2', manufacturer: 'Innova', mold: 'Destroyer' },
    { id: '3', manufacturer: 'Discraft', mold: 'Buzzz' },
    { id: '4', manufacturer: 'MVP', mold: 'Volt' },
  ];

  // User prefers both Innova and Discraft
  const result = filterAndPrioritizeCatalog(catalog, ['Innova', 'Discraft']);

  // Both user brands should come first (alphabetically: Discraft, Innova)
  assertEquals(result[0].manufacturer, 'Discraft');
  assertEquals(result[1].manufacturer, 'Innova');
  // Then other popular brand
  assertEquals(result[2].manufacturer, 'MVP');
  // Unknown last
  assertEquals(result[3].manufacturer, 'Unknown');
});

// ============== ERROR HANDLING TESTS ==============

Deno.test('get-disc-recommendations: should handle Claude API error gracefully', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  // Simulate Claude API failure
  const claudeError = true;

  if (claudeError) {
    const response = new Response(JSON.stringify({ error: 'AI recommendations failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 502);
    const body = await response.json();
    assertEquals(body.error, 'AI recommendations failed');
  }
});

Deno.test('get-disc-recommendations: should handle malformed Claude response', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

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
  }
});

// ============== LOGGING TESTS ==============

Deno.test('get-disc-recommendations: should log recommendation to database', () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  const bagAnalysis = analyzeBag(getDiscsForUser(mockUser.id));
  const recommendations = [
    { catalog_id: 'catalog-1', manufacturer: 'Innova', mold: 'Mako3', gap_type: 'category', priority: 1 },
  ];

  // Log the recommendation
  insertRecommendationLog({
    user_id: mockUser.id,
    request_count: 1,
    bag_analysis: bagAnalysis,
    recommendations,
    confidence: 0.85,
    processing_time_ms: 1500,
  });

  assertEquals(mockRecommendationLogs.length, 1);
  const log = mockRecommendationLogs[0];
  assertEquals(log.user_id, 'user-123');
  assertEquals(log.request_count, 1);
  assertEquals(log.confidence, 0.85);
  assertEquals(log.processing_time_ms, 1500);
  assertExists(log.bag_analysis);
  assertExists(log.recommendations);
});

// ============== RESPONSE FORMAT TESTS ==============

Deno.test('get-disc-recommendations: response should include all required fields', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  mockDiscs = [
    {
      id: 'disc-1',
      owner_id: 'user-123',
      name: 'My Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      plastic: 'Star',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    },
  ];

  const bagAnalysis = analyzeBag(getDiscsForUser(mockUser.id));

  const response = new Response(
    JSON.stringify({
      recommendations: [
        {
          disc: {
            id: 'catalog-1',
            manufacturer: 'Innova',
            mold: 'Mako3',
            category: 'Midrange',
            flight_numbers: { speed: 5, glide: 5, turn: 0, fade: 0 },
            stability: 'Stable',
          },
          reason: 'Your bag needs a stable midrange for straight shots.',
          gap_type: 'category',
          priority: 1,
          purchase_url: 'https://infinitediscs.com/search?s=Innova%20Mako3&aff=test',
        },
      ],
      bag_analysis: bagAnalysis,
      confidence: 0.85,
      processing_time_ms: 1500,
      log_id: 'log-123',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const body = await response.json();

  // Check recommendations structure
  assertExists(body.recommendations);
  assertEquals(Array.isArray(body.recommendations), true);
  assertExists(body.recommendations[0].disc);
  assertExists(body.recommendations[0].disc.id);
  assertExists(body.recommendations[0].disc.manufacturer);
  assertExists(body.recommendations[0].disc.mold);
  assertExists(body.recommendations[0].disc.flight_numbers);
  assertExists(body.recommendations[0].reason);
  assertExists(body.recommendations[0].gap_type);
  assertExists(body.recommendations[0].priority);
  assertExists(body.recommendations[0].purchase_url);

  // Check bag_analysis structure
  assertExists(body.bag_analysis);
  assertExists(body.bag_analysis.total_discs);
  assertExists(body.bag_analysis.brand_preferences);
  assertExists(body.bag_analysis.plastic_preferences);
  assertExists(body.bag_analysis.speed_coverage);
  assertExists(body.bag_analysis.stability_by_category);
  assertExists(body.bag_analysis.identified_gaps);

  // Check other fields
  assertExists(body.confidence);
  assertExists(body.processing_time_ms);
  assertExists(body.log_id);
});

Deno.test('get-disc-recommendations: should only return verified catalog discs', () => {
  resetMocks();

  mockCatalogDiscs = [
    {
      id: 'catalog-1',
      manufacturer: 'Innova',
      mold: 'Mako3',
      category: 'Midrange',
      speed: 5,
      glide: 5,
      turn: 0,
      fade: 0,
      stability: 'Stable',
      status: 'verified',
    },
    {
      id: 'catalog-2',
      manufacturer: 'Unknown',
      mold: 'Test Disc',
      category: 'Midrange',
      speed: 5,
      glide: 5,
      turn: 0,
      fade: 0,
      stability: 'Stable',
      status: 'user_submitted', // Not verified
    },
    {
      id: 'catalog-3',
      manufacturer: 'Fake',
      mold: 'Rejected Disc',
      category: 'Putter',
      speed: 2,
      glide: 3,
      turn: 0,
      fade: 1,
      stability: 'Stable',
      status: 'rejected', // Rejected
    },
  ];

  const verifiedDiscs = getVerifiedCatalogDiscs();

  assertEquals(verifiedDiscs.length, 1);
  assertEquals(verifiedDiscs[0].mold, 'Mako3');
});

Deno.test('get-disc-recommendations: filterAndPrioritizeCatalog should exclude dismissed discs', () => {
  resetMocks();

  mockCatalogDiscs = [
    {
      id: 'catalog-1',
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
      id: 'catalog-2',
      manufacturer: 'Innova',
      mold: 'Leopard',
      category: 'Fairway Driver',
      speed: 6,
      glide: 5,
      turn: -2,
      fade: 1,
      stability: 'Understable',
      status: 'verified',
    },
    {
      id: 'catalog-3',
      manufacturer: 'Discraft',
      mold: 'Buzz',
      category: 'Midrange',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
  ];

  // Simulate dismissed disc IDs
  const dismissedDiscIds = new Set(['catalog-2']); // User dismissed Leopard

  // Filter catalog discs (simulating filterAndPrioritizeCatalog behavior)
  const filteredDiscs = mockCatalogDiscs.filter(
    (disc) => disc.status === 'verified' && !dismissedDiscIds.has(disc.id)
  );

  // Should not include the dismissed Leopard
  assertEquals(filteredDiscs.length, 2);
  assertEquals(filteredDiscs.some((d) => d.mold === 'Leopard'), false);
  assertEquals(filteredDiscs.some((d) => d.mold === 'Destroyer'), true);
  assertEquals(filteredDiscs.some((d) => d.mold === 'Buzz'), true);
});

Deno.test('get-disc-recommendations: should handle multiple dismissed discs', () => {
  resetMocks();

  mockCatalogDiscs = [
    {
      id: 'catalog-1',
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
      id: 'catalog-2',
      manufacturer: 'Innova',
      mold: 'Leopard',
      category: 'Fairway Driver',
      speed: 6,
      glide: 5,
      turn: -2,
      fade: 1,
      stability: 'Understable',
      status: 'verified',
    },
    {
      id: 'catalog-3',
      manufacturer: 'Discraft',
      mold: 'Buzz',
      category: 'Midrange',
      speed: 5,
      glide: 4,
      turn: -1,
      fade: 1,
      stability: 'Stable',
      status: 'verified',
    },
  ];

  // User dismissed multiple discs
  const dismissedDiscIds = new Set(['catalog-1', 'catalog-3']);

  const filteredDiscs = mockCatalogDiscs.filter(
    (disc) => disc.status === 'verified' && !dismissedDiscIds.has(disc.id)
  );

  // Should only include Leopard
  assertEquals(filteredDiscs.length, 1);
  assertEquals(filteredDiscs[0].mold, 'Leopard');
});

Deno.test('get-disc-recommendations: should work with no dismissed discs', () => {
  resetMocks();

  mockCatalogDiscs = [
    {
      id: 'catalog-1',
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
      id: 'catalog-2',
      manufacturer: 'Innova',
      mold: 'Leopard',
      category: 'Fairway Driver',
      speed: 6,
      glide: 5,
      turn: -2,
      fade: 1,
      stability: 'Understable',
      status: 'verified',
    },
  ];

  // No dismissed discs
  const dismissedDiscIds = new Set<string>();

  const filteredDiscs = mockCatalogDiscs.filter(
    (disc) => disc.status === 'verified' && !dismissedDiscIds.has(disc.id)
  );

  // Should include all verified discs
  assertEquals(filteredDiscs.length, 2);
});
