import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Mark Order Delivered Function
 *
 * Allows users to mark their shipped orders as delivered when there's no tracking number.
 * This is useful when orders are shipped without tracking and the user confirms receipt.
 *
 * POST /mark-order-delivered
 * Body: {
 *   order_id: string
 * }
 *
 * Returns:
 * - success: boolean
 * - order_id: string
 */

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

  // Parse request body
  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { order_id } = body;

  // Validate order_id
  if (!order_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: order_id' }), {
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

  // Set Sentry user context
  setUser(user.id);

  // Use service role for database operations
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch the order and verify ownership
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .select('id, user_id, status, order_number, tracking_number')
    .eq('id', order_id)
    .single();

  if (orderError || !order) {
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify ownership
  if (order.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only allow marking as delivered if order is shipped
  if (order.status !== 'shipped') {
    return new Response(
      JSON.stringify({
        error: 'Only shipped orders can be marked as delivered',
        status: order.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Only allow if there's no tracking number (orders with tracking should use carrier updates)
  if (order.tracking_number) {
    return new Response(
      JSON.stringify({
        error: 'Orders with tracking numbers are updated automatically',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Update order status to delivered
    const { error: updateError } = await supabaseAdmin
      .from('sticker_orders')
      .update({
        status: 'delivered',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id);

    if (updateError) {
      throw updateError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
        order_number: order.order_number,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    captureException(error, {
      operation: 'mark-order-delivered',
      order_id: order.id,
    });
    return new Response(JSON.stringify({ error: 'Failed to update order' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
