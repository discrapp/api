import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser } from '../_shared/sentry.ts';

/**
 * Get Sticker Orders Function
 *
 * Returns all sticker orders for the authenticated user.
 *
 * GET /get-sticker-orders
 *
 * Returns:
 * - Array of orders with shipping address info
 */

const handler = async (req: Request): Promise<Response> => {
  // Only allow GET requests
  if (req.method !== 'GET') {
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

  // Create Supabase client with user's auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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

  // Use service role for database operations
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get user's orders with shipping addresses
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('sticker_orders')
    .select(
      `
      id,
      order_number,
      quantity,
      unit_price_cents,
      total_price_cents,
      status,
      tracking_number,
      created_at,
      updated_at,
      printed_at,
      shipped_at,
      shipping_address:shipping_addresses(
        id,
        name,
        street_address,
        street_address_2,
        city,
        state,
        postal_code,
        country
      )
    `
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (ordersError) {
    console.error('Failed to fetch orders:', ordersError);
    return new Response(JSON.stringify({ error: 'Failed to fetch orders' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      orders: orders || [],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
