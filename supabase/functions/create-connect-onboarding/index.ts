import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Create Connect Onboarding Function
 *
 * Creates a Stripe Connect Express account for the user and returns
 * an onboarding URL. If the user already has an account, returns a
 * new account link to continue/update onboarding.
 *
 * POST /create-connect-onboarding
 *
 * Returns:
 * - onboarding_url: URL to redirect user for Stripe onboarding
 * - account_id: Stripe Connect account ID
 * - is_new: Whether this is a newly created account
 */

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

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Check if user already has a Connect account
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('stripe_connect_account_id, stripe_connect_status, email')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('Failed to fetch profile:', profileError);
    return new Response(JSON.stringify({ error: 'Failed to fetch profile' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let accountId = profile.stripe_connect_account_id;
  let isNew = false;

  // Create new Connect account if user doesn't have one
  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email || profile.email,
        metadata: {
          user_id: user.id,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      accountId = account.id;
      isNew = true;

      // Save account ID to profile
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_status: 'pending',
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('Failed to save Connect account ID:', updateError);
        // Try to delete the Stripe account since we couldn't save it
        try {
          await stripe.accounts.del(accountId);
        } catch (deleteErr) {
          console.error('Failed to cleanup Stripe account:', deleteErr);
        }
        return new Response(JSON.stringify({ error: 'Failed to save payment setup' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (stripeErr) {
      console.error('Failed to create Stripe Connect account:', stripeErr);
      return new Response(JSON.stringify({ error: 'Failed to create payment account' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Generate onboarding link
  const appUrl = Deno.env.get('APP_URL') || 'https://aceback.app';

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/connect-refresh`,
      return_url: `${appUrl}/connect-return`,
      type: 'account_onboarding',
    });

    return new Response(
      JSON.stringify({
        onboarding_url: accountLink.url,
        account_id: accountId,
        is_new: isNew,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (linkErr) {
    console.error('Failed to create account link:', linkErr);
    return new Response(JSON.stringify({ error: 'Failed to generate onboarding link' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
