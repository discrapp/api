import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Stripe Webhook Handler
 *
 * Handles Stripe webhook events for payment processing.
 *
 * POST /stripe-webhook
 *
 * Events handled:
 * - checkout.session.completed: Updates order status to 'paid' OR marks reward as paid
 * - checkout.session.expired: Updates order status to 'cancelled'
 * - account.updated: Updates Stripe Connect account status
 */

// Webhook event types we handle
const HANDLED_EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'account.updated'];

Deno.serve(async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get Stripe signature from header
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get webhook secret
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get Stripe secret key
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    console.error('STRIPE_SECRET_KEY not configured');
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
  });

  // Get raw body for signature verification
  const body = await req.text();

  // Verify webhook signature
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if we handle this event type
  if (!HANDLED_EVENTS.includes(event.type)) {
    console.log(`Ignoring unhandled event type: ${event.type}`);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase admin client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Checkout session completed: ${session.id}`);

      // Check if this is a reward payment or sticker order
      const paymentType = session.metadata?.type;

      if (paymentType === 'reward_payment') {
        // Handle reward payment
        const recoveryEventId = session.metadata?.recovery_event_id;
        if (!recoveryEventId) {
          console.error('No recovery_event_id in session metadata for reward payment');
          return new Response(JSON.stringify({ error: 'Missing recovery_event_id in metadata' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Mark reward as paid
        const now = new Date().toISOString();
        const { error: updateError } = await supabaseAdmin
          .from('recovery_events')
          .update({
            reward_paid_at: now,
            updated_at: now,
          })
          .eq('id', recoveryEventId);

        if (updateError) {
          console.error('Failed to mark reward as paid:', updateError);
          return new Response(JSON.stringify({ error: 'Failed to mark reward as paid' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        console.log(`Reward marked as paid for recovery ${recoveryEventId}`);
        break;
      }

      // Handle sticker order payment
      const orderId = session.metadata?.order_id;
      if (!orderId) {
        console.error('No order_id in session metadata');
        return new Response(JSON.stringify({ error: 'Missing order_id in metadata' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Update order status to paid
      const { data: updatedOrder, error: updateError } = await supabaseAdmin
        .from('sticker_orders')
        .update({
          status: 'paid',
          stripe_payment_intent_id: session.payment_intent as string,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('stripe_checkout_session_id', session.id)
        .select()
        .single();

      if (updateError) {
        console.error('Failed to update order:', updateError);
        return new Response(JSON.stringify({ error: 'Failed to update order' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`Order ${updatedOrder.order_number} marked as paid`);

      // Chain the order fulfillment flow
      const functionsUrl = `${supabaseUrl}/functions/v1`;

      // Step 1: Generate QR codes
      console.log('Triggering QR code generation...');
      const qrResponse = await fetch(`${functionsUrl}/generate-order-qr-codes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ order_id: orderId }),
      });

      if (!qrResponse.ok) {
        const qrError = await qrResponse.json();
        console.error('Failed to generate QR codes:', qrError);
        // Continue anyway - order is paid, QR generation can be retried
      } else {
        console.log('QR codes generated successfully');

        // Step 2: Generate PDF
        console.log('Triggering PDF generation...');
        const pdfResponse = await fetch(`${functionsUrl}/generate-sticker-pdf`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ order_id: orderId }),
        });

        if (!pdfResponse.ok) {
          const pdfError = await pdfResponse.json();
          console.error('Failed to generate PDF:', pdfError);
          // Continue anyway - QR codes exist, PDF can be retried
        } else {
          console.log('PDF generated successfully');

          // Step 3: Send printer notification
          console.log('Sending printer notification...');
          const emailResponse = await fetch(`${functionsUrl}/send-printer-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ order_id: orderId }),
          });

          if (!emailResponse.ok) {
            const emailError = await emailResponse.json();
            console.error('Failed to send printer notification:', emailError);
          } else {
            console.log('Printer notification sent successfully');
          }
        }
      }

      // Send confirmation email to user (fire and forget - don't block on this)
      console.log('Sending order confirmation to user...');
      fetch(`${functionsUrl}/send-order-confirmation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ order_id: orderId }),
      })
        .then((res) => {
          if (res.ok) {
            console.log('Order confirmation sent to user');
          } else {
            console.error('Failed to send order confirmation');
          }
        })
        .catch((err) => console.error('Error sending order confirmation:', err));

      break;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`Checkout session expired: ${session.id}`);

      // Get order ID from metadata
      const orderId = session.metadata?.order_id;
      if (!orderId) {
        console.error('No order_id in session metadata');
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Update order status to cancelled
      const { error: updateError } = await supabaseAdmin
        .from('sticker_orders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('stripe_checkout_session_id', session.id)
        .eq('status', 'pending_payment'); // Only cancel if still pending

      if (updateError) {
        console.error('Failed to cancel order:', updateError);
      }

      break;
    }

    case 'account.updated': {
      // Handle Stripe Connect account status updates
      const account = event.data.object as Stripe.Account;
      console.log(`Connect account updated: ${account.id}`);

      // Determine the status based on account properties
      let status: 'pending' | 'active' | 'restricted' = 'pending';

      if (account.details_submitted && account.payouts_enabled) {
        status = 'active';
      } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
        status = 'restricted';
      }

      // Update the profile with the new status
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ stripe_connect_status: status })
        .eq('stripe_connect_account_id', account.id);

      if (updateError) {
        console.error('Failed to update Connect status:', updateError);
        // Don't return error - this is informational
      } else {
        console.log(`Connect account ${account.id} status updated to ${status}`);
      }

      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
