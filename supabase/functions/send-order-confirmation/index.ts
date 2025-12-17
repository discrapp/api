import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail } from '../_shared/email.ts';

/**
 * Send Order Confirmation Function
 *
 * Sends a confirmation email to the user after successful payment.
 *
 * POST /send-order-confirmation
 * Body: { order_id: string }
 *
 * Returns:
 * - success: boolean
 * - message_id: Email message ID from Resend
 */

const APP_URL = Deno.env.get('APP_URL') || 'https://aceback.app';

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

  // Get order with user email
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .select(
      `
      id,
      order_number,
      quantity,
      total_price_cents,
      status,
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
  const shippingAddress = Array.isArray(order.shipping_address)
    ? order.shipping_address[0]
    : order.shipping_address;

  // Format shipping address
  const addressLines = [
    shippingAddress?.name || 'Unknown',
    shippingAddress?.street_address || '',
    shippingAddress?.street_address_2 || '',
    `${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.postal_code || ''}`,
    shippingAddress?.country || 'US',
  ].filter(Boolean);

  // Format price
  const totalPrice = (order.total_price_cents / 100).toFixed(2);

  // Build email HTML
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10B981; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .order-details { background: #f7f7f7; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .address { background: #fff; padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin: 10px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Order Confirmed!</h1>
    </div>
    <div class="content">
      <p>Thank you for your order! We've received your payment and your QR code stickers are being prepared.</p>

      <h2>Order Details</h2>
      <div class="order-details">
        <p><strong>Order Number:</strong> ${order.order_number}</p>
        <p><strong>Quantity:</strong> ${order.quantity} sticker${order.quantity > 1 ? 's' : ''}</p>
        <p><strong>Total:</strong> $${totalPrice}</p>
        <p><strong>Status:</strong> Processing</p>
      </div>

      <h3>Shipping To:</h3>
      <div class="address">
        ${addressLines.map((line) => `<p>${line}</p>`).join('')}
      </div>

      <h3>What's Next?</h3>
      <ol>
        <li>Your stickers are being printed</li>
        <li>You'll receive a shipping notification when they're on their way</li>
        <li>Once received, scan a sticker and link it to your disc in the app</li>
      </ol>

      <p>You can view your order status anytime in the AceBack app.</p>

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
Order Confirmed!

Thank you for your order! We've received your payment and your QR code stickers are being prepared.

Order Details
-------------
Order Number: ${order.order_number}
Quantity: ${order.quantity} sticker${order.quantity > 1 ? 's' : ''}
Total: $${totalPrice}
Status: Processing

Shipping To:
${addressLines.join('\n')}

What's Next?
1. Your stickers are being printed
2. You'll receive a shipping notification when they're on their way
3. Once received, scan a sticker and link it to your disc in the app

You can view your order status anytime in the AceBack app.

If you have any questions, reply to this email or contact us at support@aceback.app

AceBack - Never lose a disc again!
`;

  // Send email
  const emailResult = await sendEmail({
    to: userEmail,
    subject: `Order Confirmed: ${order.order_number}`,
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
