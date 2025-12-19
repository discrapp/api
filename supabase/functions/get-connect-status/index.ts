import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Get Connect Status Function
 *
 * Returns the current user's Stripe Connect account status.
 * Also refreshes status from Stripe if an account exists.
 *
 * GET /get-connect-status
 *
 * Returns:
 * - status: 'none' | 'pending' | 'active' | 'restricted'
 * - can_receive_payments: boolean
 * - details_submitted: boolean (has user completed onboarding form)
 * - payouts_enabled: boolean (can receive transfers)
 */

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
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

  // Get user's profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('Failed to fetch profile:', profileError);
    return new Response(JSON.stringify({ error: 'Failed to fetch profile' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // If no Connect account, return none status
  if (!profile.stripe_connect_account_id) {
    return new Response(
      JSON.stringify({
        status: 'none',
        can_receive_payments: false,
        details_submitted: false,
        payouts_enabled: false,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Initialize Stripe to get fresh account status
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    // Return cached status if Stripe not configured
    return new Response(
      JSON.stringify({
        status: profile.stripe_connect_status || 'pending',
        can_receive_payments: profile.stripe_connect_status === 'active',
        details_submitted: false,
        payouts_enabled: profile.stripe_connect_status === 'active',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
  });

  try {
    // Fetch account from Stripe for fresh status
    const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);

    // Determine status based on account properties
    let status: 'pending' | 'active' | 'restricted' = 'pending';
    let canReceivePayments = false;

    if (account.details_submitted && account.payouts_enabled) {
      status = 'active';
      canReceivePayments = true;
    } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
      status = 'restricted';
    }

    // Update cached status if changed
    if (profile.stripe_connect_status !== status) {
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_connect_status: status })
        .eq('id', user.id);
    }

    return new Response(
      JSON.stringify({
        status,
        can_receive_payments: canReceivePayments,
        details_submitted: account.details_submitted || false,
        payouts_enabled: account.payouts_enabled || false,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (stripeErr) {
    console.error('Failed to fetch Stripe account:', stripeErr);
    // Return cached status on error
    return new Response(
      JSON.stringify({
        status: profile.stripe_connect_status || 'pending',
        can_receive_payments: profile.stripe_connect_status === 'active',
        details_submitted: false,
        payouts_enabled: profile.stripe_connect_status === 'active',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
