import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail } from '../_shared/email.ts';

/**
 * Send Order Shipped Function
 *
 * Sends a shipping notification email to the user with tracking information.
 *
 * POST /send-order-shipped
 * Body: { order_id: string }
 *
 * Returns:
 * - success: boolean
 * - message_id: Email message ID from Resend
 */

/**
 * Get tracking URL for a given tracking number
 * Auto-detects carrier based on tracking number format
 */
function getTrackingUrl(trackingNumber: string): string {
  const num = trackingNumber.toUpperCase();

  // USPS - 20-22 digits or starts with 94/93/92/91
  if (/^\d{20,22}$/.test(num) || /^9[1-4]\d{18,20}$/.test(num)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  }

  // UPS - starts with 1Z
  if (num.startsWith('1Z')) {
    return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  }

  // FedEx - 12-15 digits or 20-22 digits
  if (/^\d{12,15}$/.test(num) || /^\d{20,22}$/.test(num)) {
    return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  }

  // Default to USPS (most common for small packages)
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
}

Deno.serve(async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
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

  // Validate required fields
  if (!order_id) {
    return new Response(JSON.stringify({ error: 'Missing required field: order_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use service role for database operations
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get order with tracking info
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .select(
      `
      id,
      order_number,
      quantity,
      total_price_cents,
      status,
      tracking_number,
      shipped_at,
      user_id,
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

  // Verify order is shipped
  if (order.status !== 'shipped') {
    return new Response(JSON.stringify({ error: 'Order is not shipped' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify tracking number exists
  if (!order.tracking_number) {
    return new Response(JSON.stringify({ error: 'Order has no tracking number' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get user email from auth
  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(order.user_id);

  if (userError || !userData.user?.email) {
    console.error('Failed to get user email:', userError);
    return new Response(JSON.stringify({ error: 'User email not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userEmail = userData.user.email;

  // Handle shipping address (could be array or object from Supabase)
  const shippingAddress = Array.isArray(order.shipping_address) ? order.shipping_address[0] : order.shipping_address;

  // Format shipping address
  const addressLines = [
    shippingAddress?.name || 'Unknown',
    shippingAddress?.street_address || '',
    shippingAddress?.street_address_2 || '',
    `${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.postal_code || ''}`,
    shippingAddress?.country || 'US',
  ].filter(Boolean);

  // Get tracking URL
  const trackingUrl = getTrackingUrl(order.tracking_number);

  // Build email HTML
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #3B82F6; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .tracking-box { background: #EFF6FF; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
    .tracking-number { font-size: 24px; font-weight: bold; color: #1D4ED8; letter-spacing: 1px; }
    .track-button { display: inline-block; background: #3B82F6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 15px; }
    .order-details { background: #f7f7f7; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .address { background: #fff; padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin: 10px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Your Order Has Shipped!</h1>
    </div>
    <div class="content">
      <p>Great news! Your QR code stickers are on their way. Here's your tracking information:</p>

      <div class="tracking-box">
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Tracking Number</p>
        <p class="tracking-number">${order.tracking_number}</p>
        <a href="${trackingUrl}" class="track-button" style="color: white;">Track Your Package</a>
      </div>

      <h2>Order Details</h2>
      <div class="order-details">
        <p><strong>Order Number:</strong> ${order.order_number}</p>
        <p><strong>Quantity:</strong> ${order.quantity} sticker${order.quantity > 1 ? 's' : ''}</p>
        <p><strong>Status:</strong> Shipped</p>
      </div>

      <h3>Shipping To:</h3>
      <div class="address">
        ${addressLines.map((line) => `<p>${line}</p>`).join('')}
      </div>

      <h3>What's Next?</h3>
      <ol>
        <li>Track your package using the link above</li>
        <li>Once your stickers arrive, open the AceBack app</li>
        <li>Scan a sticker to link it to your disc</li>
        <li>Stick the QR code on your disc and you're protected!</li>
      </ol>

      <div class="footer">
        <p>If you have any questions, reply to this email or contact us at support@aceback.app</p>
        <p>AceBack - Never lose a disc again!</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  // Build plain text version
  const emailText = `
Your Order Has Shipped!

Great news! Your QR code stickers are on their way.

Tracking Number: ${order.tracking_number}
Track your package: ${trackingUrl}

Order Details
-------------
Order Number: ${order.order_number}
Quantity: ${order.quantity} sticker${order.quantity > 1 ? 's' : ''}
Status: Shipped

Shipping To:
${addressLines.join('\n')}

What's Next?
1. Track your package using the link above
2. Once your stickers arrive, open the AceBack app
3. Scan a sticker to link it to your disc
4. Stick the QR code on your disc and you're protected!

If you have any questions, reply to this email or contact us at support@aceback.app

AceBack - Never lose a disc again!
`;

  // Send email
  const emailResult = await sendEmail({
    to: userEmail,
    subject: `Your Order Has Shipped: ${order.order_number}`,
    html: emailHtml,
    text: emailText,
    replyTo: 'support@aceback.app',
  });

  if (!emailResult.success) {
    return new Response(JSON.stringify({ error: emailResult.error || 'Failed to send email' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      message_id: emailResult.messageId,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
