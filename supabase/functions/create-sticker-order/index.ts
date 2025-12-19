import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14.21.0';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Create Sticker Order Function
 *
 * Creates a new sticker order and initiates Stripe Checkout.
 *
 * POST /create-sticker-order
 * Body: {
 *   quantity: number,
 *   shipping_address_id?: string (use existing address)
 *   shipping_address?: {
 *     name: string,
 *     street_address: string,
 *     street_address_2?: string,
 *     city: string,
 *     state: string,
 *     postal_code: string,
 *     country?: string
 *   }
 * }
 *
 * Returns:
 * - checkout_url: Stripe Checkout URL
 * - order_id: Created order ID
 * - order_number: Generated order number
 */

// Price per sticker in cents
const UNIT_PRICE_CENTS = 100; // $1.00 per sticker

interface ShippingAddress {
  name: string;
  street_address: string;
  street_address_2?: string;
  city: string;
  state: string;
  postal_code: string;
  country?: string;
}

const REQUIRED_ADDRESS_FIELDS = ['name', 'street_address', 'city', 'state', 'postal_code'];

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

  const { quantity, shipping_address_id, shipping_address } = body;

  // Validate quantity
  if (quantity === undefined || quantity === null) {
    return new Response(JSON.stringify({ error: 'Missing required field: quantity' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (typeof quantity !== 'number' || quantity < 1) {
    return new Response(JSON.stringify({ error: 'Quantity must be at least 1' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate shipping address
  if (!shipping_address_id && !shipping_address) {
    return new Response(JSON.stringify({ error: 'Missing required field: shipping_address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If shipping_address provided, validate required fields
  if (shipping_address) {
    for (const field of REQUIRED_ADDRESS_FIELDS) {
      if (!shipping_address[field]) {
        return new Response(JSON.stringify({ error: `Missing shipping address field: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
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

  let addressId = shipping_address_id;
  let addressForStripe: ShippingAddress | null = null;

  // If new address provided, create it
  if (shipping_address && !shipping_address_id) {
    addressForStripe = shipping_address;
    const addressData: ShippingAddress & { user_id: string } = {
      user_id: user.id,
      name: shipping_address.name,
      street_address: shipping_address.street_address,
      street_address_2: shipping_address.street_address_2,
      city: shipping_address.city,
      state: shipping_address.state,
      postal_code: shipping_address.postal_code,
      country: shipping_address.country || 'US',
    };

    const { data: newAddress, error: addressError } = await supabaseAdmin
      .from('shipping_addresses')
      .insert(addressData)
      .select()
      .single();

    if (addressError) {
      console.error('Failed to create shipping address:', addressError);
      captureException(addressError, { operation: 'create-shipping-address', userId: user.id });
      return new Response(JSON.stringify({ error: 'Failed to create shipping address' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    addressId = newAddress.id;
  } else if (shipping_address_id) {
    // Verify the address belongs to the user and fetch details for Stripe
    const { data: existingAddress, error: addressError } = await supabaseAdmin
      .from('shipping_addresses')
      .select('id, name, street_address, street_address_2, city, state, postal_code, country')
      .eq('id', shipping_address_id)
      .eq('user_id', user.id)
      .single();

    if (addressError || !existingAddress) {
      return new Response(JSON.stringify({ error: 'Shipping address not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    addressForStripe = existingAddress;
  }

  // Calculate total
  const totalPriceCents = quantity * UNIT_PRICE_CENTS;

  // Create order
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .insert({
      user_id: user.id,
      shipping_address_id: addressId,
      quantity,
      unit_price_cents: UNIT_PRICE_CENTS,
      total_price_cents: totalPriceCents,
      status: 'pending_payment',
    })
    .select()
    .single();

  if (orderError) {
    console.error('Failed to create order:', orderError);
    captureException(orderError, { operation: 'create-order', userId: user.id, quantity });
    return new Response(JSON.stringify({ error: 'Failed to create order' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Initialize Stripe
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    console.error('STRIPE_SECRET_KEY not configured');
    // Delete the order since we can't create checkout
    await supabaseAdmin.from('sticker_orders').delete().eq('id', order.id);
    return new Response(JSON.stringify({ error: 'Payment processing not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
  });

  // Get or create Stripe Customer for billing address pre-fill
  let stripeCustomerId: string | null = null;

  // Check if user already has a Stripe customer ID
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (profile?.stripe_customer_id) {
    stripeCustomerId = profile.stripe_customer_id;

    // Update customer's address if we have one
    if (addressForStripe) {
      try {
        await stripe.customers.update(profile.stripe_customer_id, {
          name: addressForStripe.name,
          address: {
            line1: addressForStripe.street_address,
            line2: addressForStripe.street_address_2 || undefined,
            city: addressForStripe.city,
            state: addressForStripe.state,
            postal_code: addressForStripe.postal_code,
            country: addressForStripe.country || 'US',
          },
        });
      } catch (updateErr) {
        console.error('Failed to update Stripe customer address:', updateErr);
        // Continue anyway - old address is better than no pre-fill
      }
    }
  } else if (addressForStripe) {
    // Create new Stripe Customer with address for billing pre-fill
    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: addressForStripe.name,
        address: {
          line1: addressForStripe.street_address,
          line2: addressForStripe.street_address_2 || undefined,
          city: addressForStripe.city,
          state: addressForStripe.state,
          postal_code: addressForStripe.postal_code,
          country: addressForStripe.country || 'US',
        },
        metadata: {
          user_id: user.id,
        },
      });

      stripeCustomerId = customer.id;

      // Save customer ID to profile for future orders
      const { error: profileUpdateError } = await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customer.id })
        .eq('id', user.id);

      if (profileUpdateError) {
        console.error('Failed to save Stripe customer ID to profile:', profileUpdateError);
        // Continue anyway - checkout will still work
      }
    } catch (customerErr) {
      console.error('Failed to create Stripe customer:', customerErr);
      // Continue without customer - will fall back to customer_email
    }
  }

  // Get app URLs from environment
  const appUrl = Deno.env.get('APP_URL') || 'https://discrapp.com';

  // For mobile, use a simple success page that closes the browser
  const successUrl = `${appUrl}/checkout-success?order_id=${order.id}`;
  const cancelUrl = `${appUrl}/checkout-cancel?order_id=${order.id}`;

  try {
    // Build Stripe checkout session options
    const checkoutOptions: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Discr QR Code Stickers',
              description: `Pack of ${quantity} QR code sticker${quantity > 1 ? 's' : ''}`,
            },
            unit_amount: UNIT_PRICE_CENTS,
          },
          quantity,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
      },
    };

    // Use Stripe Customer if available (pre-fills billing address)
    // Otherwise fall back to customer_email
    if (stripeCustomerId) {
      checkoutOptions.customer = stripeCustomerId;
    } else {
      checkoutOptions.customer_email = user.email;
    }

    // Add shipping address to payment intent for fulfillment tracking
    if (addressForStripe) {
      checkoutOptions.payment_intent_data = {
        shipping: {
          name: addressForStripe.name,
          address: {
            line1: addressForStripe.street_address,
            line2: addressForStripe.street_address_2 || undefined,
            city: addressForStripe.city,
            state: addressForStripe.state,
            postal_code: addressForStripe.postal_code,
            country: addressForStripe.country || 'US',
          },
        },
      };
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create(checkoutOptions);

    // Update order with Stripe session ID
    const { error: updateError } = await supabaseAdmin
      .from('sticker_orders')
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq('id', order.id);

    if (updateError) {
      console.error('Failed to update order with session ID:', updateError);
    }

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
    console.error('Stripe error:', stripeError);
    captureException(stripeError, { operation: 'create-checkout-session', orderId: order.id });
    // Delete the order since checkout failed
    await supabaseAdmin.from('sticker_orders').delete().eq('id', order.id);
    return new Response(JSON.stringify({ error: 'Failed to create checkout session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(handler));
