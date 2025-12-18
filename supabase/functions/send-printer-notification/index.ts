import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail } from '../_shared/email.ts';

/**
 * Send Printer Notification Function
 *
 * Sends an email to the printer with order details and action links.
 * Called after PDF generation is complete.
 *
 * POST /send-printer-notification
 * Body: { order_id: string }
 *
 * Returns:
 * - success: boolean
 * - message_id: Email message ID from Resend
 */

// Printer email from environment
const PRINTER_EMAIL = Deno.env.get('PRINTER_EMAIL') || 'printer@aceback.app';
// Use Supabase URL for edge function links (custom domain can be added later)
const API_URL = Deno.env.get('SUPABASE_URL') || 'https://xhaogdigrsiwxdjmjzgx.supabase.co';

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

  // Get order with shipping address
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .select(
      `
      id,
      order_number,
      quantity,
      status,
      pdf_storage_path,
      printer_token,
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

  // Check if PDF is generated
  if (!order.pdf_storage_path) {
    return new Response(JSON.stringify({ error: 'PDF not yet generated for this order' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate signed URL for PDF download (valid for 7 days)
  const { data: signedUrl, error: urlError } = await supabaseAdmin.storage
    .from('sticker-pdfs')
    .createSignedUrl(order.pdf_storage_path, 60 * 60 * 24 * 7);

  if (urlError || !signedUrl) {
    console.error('Failed to generate signed URL:', urlError);
    return new Response(JSON.stringify({ error: 'Failed to generate PDF URL' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Handle shipping address (could be array or object from Supabase)
  const shippingAddress = Array.isArray(order.shipping_address) ? order.shipping_address[0] : order.shipping_address;

  // Generate action URLs with printer token
  const markPrintedUrl = `${API_URL}/functions/v1/update-order-status?action=mark_printed&token=${order.printer_token}`;
  // Ship order goes to web form (requires tracking number input)
  const markShippedUrl = `https://aceback.app/ship-order?token=${order.printer_token}`;

  // Format shipping address
  const addressLines = [
    shippingAddress?.name || 'Unknown',
    shippingAddress?.street_address || '',
    shippingAddress?.street_address_2 || '',
    `${shippingAddress?.city || ''}, ${shippingAddress?.state || ''} ${shippingAddress?.postal_code || ''}`,
    shippingAddress?.country || 'US',
  ].filter(Boolean);

  // Build email HTML
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .order-details { background: #f7f7f7; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .address { background: #fff; padding: 15px; border: 1px solid #ddd; border-radius: 5px; margin: 10px 0; }
    .btn { display: inline-block; padding: 12px 24px; margin: 10px 5px 10px 0; text-decoration: none; border-radius: 5px; font-weight: bold; }
    .btn-primary { background: #4F46E5; color: white; }
    .btn-success { background: #10B981; color: white; }
    .btn-download { background: #6B7280; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Sticker Order Ready</h1>
    </div>
    <div class="content">
      <h2>Order ${order.order_number}</h2>

      <div class="order-details">
        <p><strong>Quantity:</strong> ${order.quantity} sticker${order.quantity > 1 ? 's' : ''}</p>
        <p><strong>Status:</strong> ${order.status}</p>
      </div>

      <h3>Ship To:</h3>
      <div class="address">
        ${addressLines.map((line) => `<p>${line}</p>`).join('')}
      </div>

      <h3>Actions</h3>
      <p>
        <a href="${signedUrl.signedUrl}" class="btn btn-download">📥 Download PDF</a>
      </p>
      <p>
        <a href="${markPrintedUrl}" class="btn btn-primary">✅ Mark as Printed</a>
        <a href="${markShippedUrl}" class="btn btn-success">📦 Mark as Shipped</a>
      </p>

      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        This email was sent automatically by AceBack. Do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
`;

  // Build plain text version
  const emailText = `
New Sticker Order Ready

Order ${order.order_number}
Quantity: ${order.quantity} sticker${order.quantity > 1 ? 's' : ''}
Status: ${order.status}

Ship To:
${addressLines.join('\n')}

Actions:
- Download PDF: ${signedUrl.signedUrl}
- Mark as Printed: ${markPrintedUrl}
- Mark as Shipped: ${markShippedUrl}

This email was sent automatically by AceBack.
`;

  // Send email
  const emailResult = await sendEmail({
    to: PRINTER_EMAIL,
    subject: `New Sticker Order: ${order.order_number} (${order.quantity} stickers)`,
    html: emailHtml,
    text: emailText,
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
