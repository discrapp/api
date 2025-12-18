import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Search Disc Catalog Function
 *
 * Public endpoint for searching the disc catalog by mold name or manufacturer.
 * Powers the autocomplete functionality when users add discs.
 *
 * GET /search-disc-catalog?q=<search_term>
 *
 * Query Parameters:
 * - q: Search term (required, min 2 characters)
 * - limit: Max results to return (optional, default 20, max 50)
 *
 * Returns:
 * - Array of matching discs with all flight numbers
 * - Only returns verified discs
 * - Results sorted alphabetically by mold name
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;

Deno.serve(async (req) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse URL parameters
  const url = new URL(req.url);
  const query = url.searchParams.get('q');
  const limitParam = url.searchParams.get('limit');

  // Validate query parameter
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing required query parameter: q' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (query.length < MIN_QUERY_LENGTH) {
    return new Response(JSON.stringify({ error: 'Query must be at least 2 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse limit
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsedLimit = parseInt(limitParam, 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      limit = Math.min(parsedLimit, MAX_LIMIT);
    }
  }

  // Create Supabase client (public access - no auth required for search)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // Search disc catalog
  // Use ilike for case-insensitive partial matching
  const searchPattern = `%${query}%`;

  const { data: discs, error } = await supabase
    .from('disc_catalog')
    .select(
      `
      id,
      manufacturer,
      mold,
      category,
      speed,
      glide,
      turn,
      fade,
      stability
    `
    )
    .or(`mold.ilike.${searchPattern},manufacturer.ilike.${searchPattern}`)
    .eq('status', 'verified')
    .order('mold', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('Search error:', error);
    return new Response(JSON.stringify({ error: 'Search failed', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      results: discs || [],
      count: discs?.length || 0,
      query,
      limit,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
