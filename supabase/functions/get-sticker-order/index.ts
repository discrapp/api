import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Get Single Sticker Order Function
 *
 * Returns a single sticker order with items and QR code details.
 *
 * GET /get-sticker-order?order_id=<uuid>
 *
 * Returns:
 * - Order details with shipping address and order items (with QR codes)
 */

Deno.serve(async (req) => {
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

  // Get order_id from query params
  const url = new URL(req.url);
  const orderId = url.searchParams.get('order_id');

  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Missing order_id parameter' }), {
      status: 400,
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

  // Use service role for database operations
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get order
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .select(
      `
      id,
      user_id,
      order_number,
      quantity,
      unit_price_cents,
      total_price_cents,
      status,
      stripe_payment_intent_id,
      tracking_number,
      pdf_storage_path,
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
      ),
      items:sticker_order_items(
        id,
        qr_code:qr_codes(
          id,
          short_code
        )
      )
    `
    )
    .eq('id', orderId)
    .single();

  if (orderError) {
    if (orderError.code === 'PGRST116') {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('Failed to fetch order:', orderError);
    return new Response(JSON.stringify({ error: 'Failed to fetch order' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if user owns this order
  if (order.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'You do not have access to this order' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Remove user_id from response

  const { user_id: _userId, ...orderWithoutUserId } = order;

  return new Response(
    JSON.stringify({
      order: orderWithoutUserId,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
