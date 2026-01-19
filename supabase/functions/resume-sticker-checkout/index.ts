import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14.21.0';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Resume Sticker Checkout Function
 *
 * Creates a new Stripe Checkout session for an existing pending_payment order.
 * Stripe checkout sessions expire after 24 hours, so we create a new one.
 *
 * POST /resume-sticker-checkout
 * Body: {
 *   order_id: string
 * }
 *
 * Returns:
 * - checkout_url: Stripe Checkout URL
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
  let body;
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
    .select(
      `
      id,
      user_id,
      quantity,
      unit_price_cents,
      total_price_cents,
      status,
      order_number,
      shipping_address:shipping_addresses(
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

  // Verify order is in pending_payment status
  if (order.status !== 'pending_payment') {
    return new Response(
      JSON.stringify({
        error: 'Order is not awaiting payment',
        status: order.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Initialize Stripe
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    captureException(new Error('STRIPE_SECRET_KEY not configured'), {
      operation: 'resume-sticker-checkout',
    });
    return new Response(JSON.stringify({ error: 'Payment service not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
  });

  // Get shipping address (handle array or single object from Supabase)
  const shippingAddress = Array.isArray(order.shipping_address) ? order.shipping_address[0] : order.shipping_address;

  if (!shippingAddress) {
    return new Response(JSON.stringify({ error: 'Order missing shipping address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create new Stripe Checkout session
  const appUrl = Deno.env.get('APP_URL') || 'https://discrapp.com';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Discr QR Code Stickers',
              description: `${order.quantity} weatherproof QR code stickers for your discs`,
            },
            unit_amount: order.unit_price_cents,
          },
          quantity: order.quantity,
        },
      ],
      shipping_address_collection: undefined, // Already have address
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        user_id: user.id,
      },
      success_url: `${appUrl}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/checkout-cancel?order_id=${order.id}`,
      customer_email: user.email,
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 0, currency: 'usd' },
            display_name: 'Free Shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 7 },
            },
          },
        },
      ],
    });

    // Update order with new checkout session ID
    await supabaseAdmin.from('sticker_orders').update({ stripe_checkout_session_id: session.id }).eq('id', order.id);

    return new Response(
      JSON.stringify({
        checkout_url: session.url,
        order_id: order.id,
        order_number: order.order_number,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (stripeError) {
    captureException(stripeError, {
      operation: 'resume-sticker-checkout',
      order_id: order.id,
    });
    return new Response(JSON.stringify({ error: 'Failed to create checkout session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
