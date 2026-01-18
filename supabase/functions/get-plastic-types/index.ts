import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';

/**
 * Get Plastic Types Function
 *
 * Public endpoint for fetching plastic types by manufacturer.
 * Powers the plastic dropdown when users add/edit discs.
 *
 * GET /get-plastic-types?manufacturer=<manufacturer_name>
 *
 * Query Parameters:
 * - manufacturer: Filter by manufacturer name (optional, case-insensitive)
 *
 * Returns:
 * - Array of plastic types sorted by display_order
 * - Includes official and approved plastics
 * - If user is authenticated, also includes their pending submissions
 */

const handler = async (req: Request): Promise<Response> => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse URL parameters
  const url = new URL(req.url);
  const manufacturer = url.searchParams.get('manufacturer');

  // Create Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Check for auth header to include user's pending submissions
  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });

  // Build query
  let query = supabase
    .from('plastic_types')
    .select('id, manufacturer, plastic_name, display_order, status');

  // Filter by manufacturer if provided (case-insensitive)
  if (manufacturer) {
    query = query.ilike('manufacturer', manufacturer);
  }

  // Order by manufacturer, then display_order
  query = query.order('manufacturer', { ascending: true }).order('display_order', { ascending: true });

  const { data: plastics, error } = await query;

  if (error) {
    console.error('Query error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch plastic types', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Group by manufacturer for easier consumption
  const grouped: Record<string, string[]> = {};
  for (const plastic of plastics || []) {
    if (!grouped[plastic.manufacturer]) {
      grouped[plastic.manufacturer] = [];
    }
    grouped[plastic.manufacturer].push(plastic.plastic_name);
  }

  return new Response(
    JSON.stringify({
      plastics: plastics || [],
      grouped,
      count: plastics?.length || 0,
      manufacturer: manufacturer || null,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
