import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Disc Recommendations Function (Fill the Bag)
 *
 * Uses Claude AI to analyze a user's disc bag and recommend discs to fill gaps
 * in their collection, with affiliate links to Infinite Discs.
 *
 * POST /get-disc-recommendations
 * Body: { count: 1 | 3 | 5 }
 *
 * Returns:
 * - recommendations: Array of recommended discs with purchase links
 * - bag_analysis: Analysis of user's current bag
 * - confidence: AI confidence in recommendations
 */

const VALID_COUNTS = [1, 3, 5];

interface FlightNumbers {
  speed: number;
  glide: number;
  turn: number;
  fade: number;
}

interface UserDisc {
  id: string;
  name: string | null;
  manufacturer: string | null;
  mold: string | null;
  plastic: string | null;
  flight_numbers: FlightNumbers | null;
}

interface CatalogDisc {
  id: string;
  manufacturer: string;
  mold: string;
  category: string | null;
  speed: number;
  glide: number;
  turn: number;
  fade: number;
  stability: string | null;
}

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

interface ClaudeRecommendation {
  catalog_id: string;
  manufacturer: string;
  mold: string;
  reason: string;
  gap_type: 'speed_range' | 'stability' | 'category';
  priority: number;
}

interface TradeInCandidate {
  disc_id: string;
  reason: string;
}

interface ClaudeResponse {
  recommendations: ClaudeRecommendation[];
  trade_in_candidates: TradeInCandidate[];
  identified_gaps: string[];
  confidence: number;
}

interface ClaudeVisionResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
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

// Stability classification based on turn + fade
function classifyStability(turn: number, fade: number): 'understable' | 'stable' | 'overstable' {
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
function analyzeBag(discs: UserDisc[]): BagAnalysis {
  const brandCounts: Record<string, number> = {};
  const plasticCounts: Record<string, number> = {};
  const speeds: number[] = [];
  const stabilityByCategory: Record<string, { understable: number; stable: number; overstable: number }> = {};

  for (const disc of discs) {
    if (disc.manufacturer) {
      brandCounts[disc.manufacturer] = (brandCounts[disc.manufacturer] || 0) + 1;
    }

    if (disc.plastic) {
      plasticCounts[disc.plastic] = (plasticCounts[disc.plastic] || 0) + 1;
    }

    if (disc.flight_numbers?.speed) {
      speeds.push(disc.flight_numbers.speed);
    }

    if (disc.flight_numbers) {
      const category = classifyCategory(disc.flight_numbers.speed);
      const stability = classifyStability(disc.flight_numbers.turn, disc.flight_numbers.fade);

      if (!stabilityByCategory[category]) {
        stabilityByCategory[category] = { understable: 0, stable: 0, overstable: 0 };
      }
      stabilityByCategory[category][stability]++;
    }
  }

  const brandPreferences = Object.entries(brandCounts)
    .map(([manufacturer, count]) => ({ manufacturer, count }))
    .sort((a, b) => b.count - a.count);

  const plasticPreferences = Object.entries(plasticCounts)
    .map(([plastic, count]) => ({ plastic, count }))
    .sort((a, b) => b.count - a.count);

  const sortedSpeeds = [...new Set(speeds)].sort((a, b) => a - b);
  const speedGaps: SpeedGap[] = [];

  for (let i = 0; i < sortedSpeeds.length - 1; i++) {
    const gap = sortedSpeeds[i + 1] - sortedSpeeds[i];
    if (gap >= 3) {
      speedGaps.push({ from: sortedSpeeds[i], to: sortedSpeeds[i + 1] });
    }
  }

  const stabilityArray = Object.entries(stabilityByCategory).map(([category, counts]) => ({
    category,
    ...counts,
  }));

  const identifiedGaps: string[] = [];
  const categories = ['Distance Driver', 'Fairway Driver', 'Midrange', 'Putter'];

  for (const cat of categories) {
    if (!stabilityByCategory[cat]) {
      identifiedGaps.push(`No ${cat}s in bag`);
    } else {
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

// Generate Infinite Discs affiliate link
// URL format: https://infinitediscs.com/{manufacturer-slug}-{mold-slug}
// Example: https://infinitediscs.com/dynamic-discs-deputy
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

// Speed ranges for disc categories
const CATEGORY_SPEED_RANGES: Record<string, { min: number; max: number }> = {
  'Distance Driver': { min: 11, max: 14 },
  'Fairway Driver': { min: 7, max: 10 },
  Midrange: { min: 4, max: 6 },
  Putter: { min: 1, max: 3 },
};

// Build gap-based filter criteria from bag analysis
interface GapFilter {
  type: 'speed_gap' | 'stability_gap' | 'category_gap';
  description: string;
  speedMin?: number;
  speedMax?: number;
  stability?: 'understable' | 'stable' | 'overstable';
}

function identifyGapFilters(bagAnalysis: BagAnalysis): GapFilter[] {
  const filters: GapFilter[] = [];

  // Add filters for speed gaps
  for (const gap of bagAnalysis.speed_coverage.gaps) {
    filters.push({
      type: 'speed_gap',
      description: `Speed gap ${gap.from}-${gap.to}`,
      speedMin: gap.from,
      speedMax: gap.to,
    });
  }

  // Add filters for missing stability in each category
  const categories = ['Distance Driver', 'Fairway Driver', 'Midrange', 'Putter'];
  for (const category of categories) {
    const catStability = bagAnalysis.stability_by_category.find((s) => s.category === category);
    const speedRange = CATEGORY_SPEED_RANGES[category];

    if (!catStability) {
      // Missing entire category - add all stabilities
      filters.push({
        type: 'category_gap',
        description: `Missing ${category}`,
        speedMin: speedRange.min,
        speedMax: speedRange.max,
      });
    } else {
      // Check for missing stabilities within category
      if (catStability.understable === 0) {
        filters.push({
          type: 'stability_gap',
          description: `No understable ${category}`,
          speedMin: speedRange.min,
          speedMax: speedRange.max,
          stability: 'understable',
        });
      }
      if (catStability.stable === 0) {
        filters.push({
          type: 'stability_gap',
          description: `No stable ${category}`,
          speedMin: speedRange.min,
          speedMax: speedRange.max,
          stability: 'stable',
        });
      }
      if (catStability.overstable === 0) {
        filters.push({
          type: 'stability_gap',
          description: `No overstable ${category}`,
          speedMin: speedRange.min,
          speedMax: speedRange.max,
          stability: 'overstable',
        });
      }
    }
  }

  return filters;
}

// Query catalog for discs that match gap filters
// deno-lint-ignore no-explicit-any
async function queryDiscsForGaps(
  supabaseAdmin: any,
  gapFilters: GapFilter[],
  userBrands: string[],
  dismissedDiscIds: Set<string> = new Set()
): Promise<CatalogDisc[]> {
  const allMatchingDiscs: CatalogDisc[] = [];
  const seenIds = new Set<string>();

  // Query for each gap filter
  for (const filter of gapFilters) {
    let query = supabaseAdmin
      .from('disc_catalog')
      .select('id, manufacturer, mold, category, speed, glide, turn, fade, stability')
      .eq('status', 'verified');

    // Apply speed range filter
    if (filter.speedMin !== undefined) {
      query = query.gte('speed', filter.speedMin);
    }
    if (filter.speedMax !== undefined) {
      query = query.lte('speed', filter.speedMax);
    }

    // Apply stability filter based on turn/fade values
    if (filter.stability === 'understable') {
      query = query.lte('turn', -2);
    } else if (filter.stability === 'overstable') {
      query = query.or('fade.gte.3,turn.gte.1');
    } else if (filter.stability === 'stable') {
      query = query.gt('turn', -2).lt('fade', 3);
    }

    const { data: discs } = await query.limit(50);

    if (discs) {
      for (const disc of discs as CatalogDisc[]) {
        // Skip dismissed discs
        if (dismissedDiscIds.has(disc.id)) continue;
        if (!seenIds.has(disc.id)) {
          seenIds.add(disc.id);
          allMatchingDiscs.push(disc);
        }
      }
    }
  }

  // Prioritize user's preferred brands
  const userBrandsLower = userBrands.map((b) => b.toLowerCase());
  const popularBrandsLower = POPULAR_BRANDS.map((b) => b.toLowerCase());

  return allMatchingDiscs.sort((a, b) => {
    const aManufacturerLower = a.manufacturer.toLowerCase();
    const bManufacturerLower = b.manufacturer.toLowerCase();

    const aIsUserBrand = userBrandsLower.includes(aManufacturerLower);
    const bIsUserBrand = userBrandsLower.includes(bManufacturerLower);
    const aIsPopular = popularBrandsLower.includes(aManufacturerLower);
    const bIsPopular = popularBrandsLower.includes(bManufacturerLower);

    if (aIsUserBrand && !bIsUserBrand) return -1;
    if (!aIsUserBrand && bIsUserBrand) return 1;
    if (aIsPopular && !bIsPopular) return -1;
    if (!aIsPopular && bIsPopular) return 1;

    return a.manufacturer.localeCompare(b.manufacturer) || a.mold.localeCompare(b.mold);
  });
}

// Legacy filter function (fallback if no gaps identified)
function filterAndPrioritizeCatalog(
  catalogDiscs: CatalogDisc[],
  userBrands: string[],
  maxDiscs: number = 150,
  dismissedDiscIds: Set<string> = new Set()
): CatalogDisc[] {
  // Filter out dismissed discs first
  const filteredDiscs = catalogDiscs.filter((disc) => !dismissedDiscIds.has(disc.id));

  const userBrandsLower = userBrands.map((b) => b.toLowerCase());
  const popularBrandsLower = POPULAR_BRANDS.map((b) => b.toLowerCase());

  const sortedDiscs = [...filteredDiscs].sort((a, b) => {
    const aManufacturerLower = a.manufacturer.toLowerCase();
    const bManufacturerLower = b.manufacturer.toLowerCase();

    const aIsUserBrand = userBrandsLower.includes(aManufacturerLower);
    const bIsUserBrand = userBrandsLower.includes(bManufacturerLower);
    const aIsPopular = popularBrandsLower.includes(aManufacturerLower);
    const bIsPopular = popularBrandsLower.includes(bManufacturerLower);

    if (aIsUserBrand && !bIsUserBrand) return -1;
    if (!aIsUserBrand && bIsUserBrand) return 1;
    if (aIsPopular && !bIsPopular) return -1;
    if (!aIsPopular && bIsPopular) return 1;

    if (a.manufacturer !== b.manufacturer) {
      return a.manufacturer.localeCompare(b.manufacturer);
    }
    return a.mold.localeCompare(b.mold);
  });

  return sortedDiscs.slice(0, maxDiscs);
}

// Build Claude prompt for recommendations
function buildClaudePrompt(
  bagAnalysis: BagAnalysis,
  catalogDiscs: CatalogDisc[],
  userDiscs: UserDisc[],
  count: number
): string {
  const topBrands = bagAnalysis.brand_preferences.slice(0, 5).map((b) => b.manufacturer);
  const topPlastics = bagAnalysis.plastic_preferences.slice(0, 3).map((p) => p.plastic);

  // Build user's disc list for trade-in analysis
  const userDiscList = userDiscs
    .filter((d) => d.flight_numbers)
    .map(
      (d) =>
        `- ${d.manufacturer || 'Unknown'} ${d.mold || d.name || 'Unknown'}: ${d.flight_numbers?.speed}/${d.flight_numbers?.glide}/${d.flight_numbers?.turn}/${d.flight_numbers?.fade} [ID: ${d.id}]`
    )
    .join('\n');

  const stabilityMatrix = bagAnalysis.stability_by_category
    .map((s) => `  ${s.category}: understable=${s.understable}, stable=${s.stable}, overstable=${s.overstable}`)
    .join('\n');

  // Filter and prioritize catalog to user's brands and popular brands
  const prioritizedCatalog = filterAndPrioritizeCatalog(catalogDiscs, topBrands, 150);

  const catalogList = prioritizedCatalog
    .map(
      (d) =>
        `- ${d.manufacturer} ${d.mold} (${d.category || 'Unknown'}): ${d.speed}/${d.glide}/${d.turn}/${d.fade} [ID: ${d.id}]`
    )
    .join('\n');

  // Build brand preferences with counts to show which is PRIMARY
  const brandPrefsWithCounts = bagAnalysis.brand_preferences
    .slice(0, 5)
    .map((b) => `${b.manufacturer} (${b.count} disc${b.count > 1 ? 's' : ''})`)
    .join(', ');

  // Identify the PRIMARY brand (highest count)
  const primaryBrand = bagAnalysis.brand_preferences[0]?.manufacturer || null;
  const primaryBrandCount = bagAnalysis.brand_preferences[0]?.count || 0;

  return `You are an expert disc golf equipment advisor. Analyze this user's bag, recommend ${count} disc(s) to fill gaps, and identify any redundant discs they could trade in.

USER'S CURRENT DISCS:
${userDiscList || '  No discs with flight numbers'}

USER'S BAG ANALYSIS:
- Total discs: ${bagAnalysis.total_discs}
- Preferred plastics: ${topPlastics.join(', ') || 'None established'}
- Speed range: ${bagAnalysis.speed_coverage.min}-${bagAnalysis.speed_coverage.max}
- Speed gaps: ${bagAnalysis.speed_coverage.gaps.map((g) => `${g.from}-${g.to}`).join(', ') || 'None'}

STABILITY BY CATEGORY:
${stabilityMatrix || '  No discs with flight numbers'}

IDENTIFIED GAPS:
${bagAnalysis.identified_gaps.map((g) => `- ${g}`).join('\n') || '- None identified'}

BRAND PREFERENCES (CRITICAL - ranked by disc count):
${brandPrefsWithCounts || 'No brand preferences established'}
${primaryBrand ? `\n**PRIMARY BRAND: ${primaryBrand}** (${primaryBrandCount} discs) - This is the user's main brand. MOST recommendations should be from this brand.` : ''}

Popular brands for variety: ${POPULAR_BRANDS.slice(0, 8).join(', ')}

AVAILABLE DISCS TO RECOMMEND FROM:
${catalogList}

CRITICAL INSTRUCTIONS:
1. **RECOMMENDATIONS**: Recommend ${count} disc(s) to fill gaps
   - PRIMARY BRAND FIRST: Use ${primaryBrand || 'user preferred brands'} for majority of recommendations
   - Prioritize gaps: (1) Missing categories, (2) Missing stabilities, (3) Speed gaps
   - Each recommendation should fill a DIFFERENT gap

2. **TRADE-IN CANDIDATES**: Identify discs the user could trade in (0-3 max)
   - Look for DUPLICATES: Multiple discs with very similar flight numbers (within ±1 on each stat)
   - Look for REDUNDANCY: Discs that overlap significantly with others in the same slot
   - Look for OUTLIERS: Discs that don't fit the user's preferred brands/style
   - Only suggest trade-ins if genuinely redundant - don't suggest trading core bag discs
   - If the bag is well-optimized, return empty trade_in_candidates array

Return ONLY this JSON (no other text):
{
  "recommendations": [
    {
      "catalog_id": "<uuid from catalog>",
      "manufacturer": "<string>",
      "mold": "<string>",
      "reason": "<2-3 sentence explanation>",
      "gap_type": "speed_range|stability|category",
      "priority": <1 to ${count}>
    }
  ],
  "trade_in_candidates": [
    {
      "disc_id": "<uuid from user's discs>",
      "reason": "<why this disc is redundant or could be traded>"
    }
  ],
  "identified_gaps": ["<list of gaps found>"],
  "confidence": <0.0-1.0>
}`;
}

const handler = async (req: Request): Promise<Response> => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // Verify user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Set Sentry user context
  setUser(user.id);

  // Parse request body
  let body: { count?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate count
  const count = body.count;
  if (!count || !VALID_COUNTS.includes(count)) {
    return new Response(JSON.stringify({ error: 'count must be 1, 3, or 5' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch user's discs
  const { data: userDiscs, error: discsError } = await supabase
    .from('discs')
    .select('id, name, manufacturer, mold, plastic, flight_numbers')
    .eq('owner_id', user.id);

  if (discsError) {
    console.error('Failed to fetch user discs:', discsError);
    captureException(new Error('Failed to fetch user discs'), {
      operation: 'get-disc-recommendations',
      userId: user.id,
      error: discsError,
    });
    return new Response(JSON.stringify({ error: 'Failed to fetch disc bag' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!userDiscs || userDiscs.length === 0) {
    return new Response(JSON.stringify({ error: 'No discs in bag. Add discs to get recommendations.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for Anthropic API key
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'AI recommendations not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get affiliate ID from environment (defaults to empty if not set)
  const affiliateId = Deno.env.get('INFINITE_DISCS_AFFILIATE_ID') ?? '';

  // Create service role client for catalog access and logging
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Fetch user's dismissed disc recommendations
  const { data: dismissedData } = await supabase
    .from('dismissed_disc_recommendations')
    .select('disc_catalog_id')
    .eq('user_id', user.id);

  const dismissedDiscIds = new Set((dismissedData || []).map((d) => d.disc_catalog_id));

  // Analyze bag first to identify gaps
  const bagAnalysis = analyzeBag(userDiscs);
  const topBrands = bagAnalysis.brand_preferences.slice(0, 5).map((b) => b.manufacturer);

  // Identify gap filters from bag analysis
  const gapFilters = identifyGapFilters(bagAnalysis);

  // Fetch discs that match the identified gaps (smart filtering)
  let catalogDiscs: CatalogDisc[] = [];
  if (gapFilters.length > 0) {
    // Query database for discs that match specific gaps
    catalogDiscs = await queryDiscsForGaps(supabaseAdmin, gapFilters, topBrands, dismissedDiscIds);
  }

  // Fallback: if no gap-specific discs found, fetch general catalog
  if (catalogDiscs.length === 0) {
    const { data: fallbackDiscs, error: catalogError } = await supabaseAdmin
      .from('disc_catalog')
      .select('id, manufacturer, mold, category, speed, glide, turn, fade, stability')
      .eq('status', 'verified')
      .order('manufacturer')
      .order('mold')
      .limit(500);

    if (catalogError) {
      console.error('Failed to fetch disc catalog:', catalogError);
      captureException(new Error('Failed to fetch disc catalog'), {
        operation: 'get-disc-recommendations',
        error: catalogError,
      });
      return new Response(JSON.stringify({ error: 'Failed to fetch disc catalog' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    catalogDiscs = filterAndPrioritizeCatalog(fallbackDiscs || [], topBrands, 200, dismissedDiscIds);
  }

  const startTime = Date.now();

  try {
    // Build Claude prompt (bagAnalysis already computed above)
    const prompt = buildClaudePrompt(bagAnalysis, catalogDiscs, userDiscs, count);

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      console.error('Claude API error:', claudeResponse.status, errorText);
      captureException(new Error(`Claude API error: ${claudeResponse.status}`), {
        operation: 'get-disc-recommendations',
        statusCode: claudeResponse.status,
        errorText,
      });
      return new Response(
        JSON.stringify({
          error: 'AI recommendations failed',
          details: `Claude API returned ${claudeResponse.status}`,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const claudeData: ClaudeVisionResponse = await claudeResponse.json();
    const processingTime = Date.now() - startTime;

    // Extract the text response
    const textContent = claudeData.content.find((c) => c.type === 'text');
    if (!textContent?.text) {
      console.error('No text response from Claude');
      return new Response(JSON.stringify({ error: 'AI returned no recommendations' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse the JSON response from Claude
    let aiResponse: ClaudeResponse;
    try {
      let jsonText = textContent.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.slice(7);
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3);
      }
      jsonText = jsonText.trim();

      aiResponse = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', textContent.text);
      captureException(parseError, {
        operation: 'get-disc-recommendations',
        rawResponse: textContent.text,
      });
      return new Response(
        JSON.stringify({
          error: 'AI response could not be parsed',
          raw_response: textContent.text,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Build recommendations with full disc details and affiliate links
    const recommendations = aiResponse.recommendations.map((rec) => {
      const catalogDisc = catalogDiscs?.find((d) => d.id === rec.catalog_id);
      return {
        disc: catalogDisc
          ? {
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
            }
          : {
              id: rec.catalog_id,
              manufacturer: rec.manufacturer,
              mold: rec.mold,
              category: null,
              flight_numbers: null,
              stability: null,
            },
        reason: rec.reason,
        gap_type: rec.gap_type,
        priority: rec.priority,
        purchase_url: generateAffiliateUrl(rec.manufacturer, rec.mold, affiliateId),
      };
    });

    // Build trade-in candidates with full disc details
    const tradeInCandidates = (aiResponse.trade_in_candidates || []).map((candidate) => {
      const userDisc = userDiscs.find((d) => d.id === candidate.disc_id);
      return {
        disc: userDisc
          ? {
              id: userDisc.id,
              name: userDisc.name,
              manufacturer: userDisc.manufacturer,
              mold: userDisc.mold,
              plastic: userDisc.plastic,
              flight_numbers: userDisc.flight_numbers,
            }
          : { id: candidate.disc_id },
        reason: candidate.reason,
      };
    });

    // Update bag_analysis with AI-identified gaps
    const finalBagAnalysis = {
      ...bagAnalysis,
      identified_gaps: aiResponse.identified_gaps || bagAnalysis.identified_gaps,
    };

    // Log the recommendation
    const { data: logData, error: logError } = await supabaseAdmin
      .from('disc_recommendation_logs')
      .insert({
        user_id: user.id,
        request_count: count,
        bag_analysis: finalBagAnalysis,
        recommendations: recommendations,
        ai_raw_response: aiResponse,
        confidence: aiResponse.confidence,
        processing_time_ms: processingTime,
        model_version: 'claude-sonnet-4-20250514',
      })
      .select('id')
      .single();

    if (logError) {
      console.error('Failed to log recommendation:', logError);
    }

    return new Response(
      JSON.stringify({
        recommendations,
        trade_in_candidates: tradeInCandidates,
        bag_analysis: finalBagAnalysis,
        confidence: aiResponse.confidence,
        processing_time_ms: processingTime,
        log_id: logData?.id || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Recommendation error:', error);
    captureException(error, {
      operation: 'get-disc-recommendations',
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Recommendation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
