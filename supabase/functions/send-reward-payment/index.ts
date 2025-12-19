import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Send Reward Payment Function
 *
 * Creates a Stripe Checkout session for the owner to pay the finder's reward.
 * Uses Stripe Connect to transfer funds directly to the finder's account.
 * Owner pays processing fees so finder receives full reward amount.
 *
 * POST /send-reward-payment
 * Body: { recovery_event_id: string }
 *
 * Returns:
 * - checkout_url: Stripe Checkout URL for payment
 * - amount: Total amount owner will pay (reward + fees)
 * - reward_amount: Reward amount finder will receive
 * - fee_amount: Processing fee amount
 */

// Stripe fee calculation: 2.9% + $0.30
function calculateStripeFee(amountCents: number): number {
  // To ensure finder gets exact reward, we need to calculate what to charge
  // If we want finder to get X, we need to charge: (X + 30) / (1 - 0.029)
  const feePercent = 0.029;
  const flatFeeCents = 30;

  // Total to charge = (reward + flat_fee) / (1 - percentage_fee)
  const totalCents = Math.ceil((amountCents + flatFeeCents) / (1 - feePercent));
  return totalCents - amountCents;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { recovery_event_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { recovery_event_id } = body;

  if (!recovery_event_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: recovery_event_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get recovery event with disc and finder info
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .select(
      `
      id,
      finder_id,
      status,
      reward_paid_at,
      disc:discs!recovery_events_disc_id_fk(
        id,
        name,
        mold,
        reward_amount,
        owner_id
      )
    `
    )
    .eq('id', recovery_event_id)
    .single();

  if (recoveryError || !recovery) {
    return new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Handle disc being array or object
  const discData = recovery.disc as
    | { id: string; name: string; mold: string; reward_amount: number | null; owner_id: string }
    | { id: string; name: string; mold: string; reward_amount: number | null; owner_id: string }[]
    | null;
  const disc = Array.isArray(discData) ? discData[0] : discData;

  // Verify user is the disc owner
  if (!disc || disc.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the disc owner can send the reward' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if recovery is in 'recovered' status
  if (recovery.status !== 'recovered') {
    return new Response(
      JSON.stringify({ error: 'Reward can only be sent after disc is recovered' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Check if already paid
  if (recovery.reward_paid_at) {
    return new Response(
      JSON.stringify({
        error: 'Reward has already been paid',
        reward_paid_at: recovery.reward_paid_at,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Check if disc has a reward
  if (!disc.reward_amount || disc.reward_amount <= 0) {
    return new Response(JSON.stringify({ error: 'This disc does not have a reward set' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get finder's Stripe Connect account
  const { data: finderProfile, error: finderError } = await supabaseAdmin
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', recovery.finder_id)
    .single();

  if (finderError || !finderProfile) {
    return new Response(JSON.stringify({ error: 'Finder profile not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!finderProfile.stripe_connect_account_id || finderProfile.stripe_connect_status !== 'active') {
    return new Response(
      JSON.stringify({
        error: 'Finder has not set up card payments. Please use Venmo or contact them directly.',
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
    console.error('STRIPE_SECRET_KEY not configured');
    return new Response(JSON.stringify({ error: 'Payment processing not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
  });

  // Calculate amounts in cents
  const rewardAmountCents = Math.round(disc.reward_amount * 100);
  const feeAmountCents = calculateStripeFee(rewardAmountCents);
  const totalAmountCents = rewardAmountCents + feeAmountCents;

  const appUrl = Deno.env.get('APP_URL') || 'https://aceback.app';
  const successUrl = `${appUrl}/reward-success?recovery_id=${recovery_event_id}`;
  const cancelUrl = `${appUrl}/reward-cancel?recovery_id=${recovery_event_id}`;

  try {
    // Create Stripe Checkout session with Connect transfer
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Reward for returning ${disc.mold || disc.name}`,
              description: `Thank you for returning my disc! The finder will receive $${disc.reward_amount.toFixed(2)}.`,
            },
            unit_amount: totalAmountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_intent_data: {
        // Transfer the reward amount to the finder's Connect account
        transfer_data: {
          destination: finderProfile.stripe_connect_account_id,
          amount: rewardAmountCents, // Finder gets the full reward amount
        },
        metadata: {
          recovery_event_id: recovery_event_id,
          type: 'reward_payment',
        },
      },
      metadata: {
        recovery_event_id: recovery_event_id,
        type: 'reward_payment',
        owner_id: user.id,
        finder_id: recovery.finder_id,
      },
      customer_email: user.email,
    });

    return new Response(
      JSON.stringify({
        checkout_url: session.url,
        amount: totalAmountCents / 100,
        reward_amount: disc.reward_amount,
        fee_amount: feeAmountCents / 100,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (stripeErr) {
    console.error('Failed to create checkout session:', stripeErr);
    return new Response(JSON.stringify({ error: 'Failed to create payment session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
