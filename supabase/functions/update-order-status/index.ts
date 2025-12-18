import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Update Order Status Function
 *
 * Unauthenticated endpoint to update sticker order status.
 * Uses printer_token for authentication (sent via email links).
 *
 * POST /update-order-status
 * Body: {
 *   printer_token: string,
 *   status: 'processing' | 'printed' | 'shipped' | 'delivered',
 *   tracking_number?: string (required when status is 'shipped')
 * }
 *
 * Returns:
 * - Updated order details
 */

// Valid statuses that can be set via this endpoint
const VALID_STATUSES = ['processing', 'printed', 'shipped', 'delivered'];

// Valid status transitions
// Note: shipped is allowed from paid/processing/printed since shipping implies printing is done
const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending_payment: [], // Can't transition from pending_payment via this endpoint
  paid: ['processing', 'printed', 'shipped'], // Can skip to shipped (auto-sets printed)
  processing: ['printed', 'shipped'], // Can skip to shipped (auto-sets printed)
  printed: ['shipped'],
  shipped: ['delivered'],
  delivered: [], // Terminal state
  cancelled: [], // Terminal state
};

const WEB_APP_URL = 'https://aceback.app';

// Helper to return error response (redirect for GET, JSON for POST)
function errorResponse(error: string, statusCode: number, isGet: boolean): Response {
  if (isGet) {
    const redirectUrl = new URL(`${WEB_APP_URL}/order-updated`);
    redirectUrl.searchParams.set('error', error);
    return Response.redirect(redirectUrl.toString(), 302);
  }
  return new Response(JSON.stringify({ error }), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  let printer_token: string | undefined;
  let status: string | undefined;
  let tracking_number: string | undefined;
  const isGet = req.method === 'GET';

  if (isGet) {
    // Parse query parameters for GET requests (email links)
    const url = new URL(req.url);
    printer_token = url.searchParams.get('token') || undefined;
    const action = url.searchParams.get('action');
    tracking_number = url.searchParams.get('tracking_number') || undefined;

    // Map action to status
    if (action === 'mark_printed') {
      status = 'printed';
    } else if (action === 'mark_shipped') {
      status = 'shipped';
    } else if (action === 'mark_processing') {
      status = 'processing';
    } else if (action === 'mark_delivered') {
      status = 'delivered';
    }
  } else if (req.method === 'POST') {
    // Parse JSON body for POST requests
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    printer_token = body.printer_token;
    status = body.status;
    tracking_number = body.tracking_number;
  } else {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!printer_token) {
    return errorResponse('Missing required field: printer_token', 400, isGet);
  }

  if (!status) {
    return errorResponse('Missing required field: status', 400, isGet);
  }

  // Validate status value
  if (!VALID_STATUSES.includes(status)) {
    return errorResponse('Invalid status', 400, isGet);
  }

  // tracking_number is optional for shipped status (some orders ship without tracking)

  // Use service role for database operations
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Find order by printer_token
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', printer_token)
    .single();

  if (orderError || !order) {
    return errorResponse('Order not found', 404, isGet);
  }

  // Validate status transition
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  if (!allowedTransitions.includes(status)) {
    return errorResponse(`Invalid status transition from ${order.status} to ${status}`, 400, isGet);
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  // Set timestamp fields based on status
  const now = new Date().toISOString();
  if (status === 'printed') {
    updateData.printed_at = now;
  } else if (status === 'shipped') {
    updateData.shipped_at = now;
    // Only set tracking_number if provided (optional for shipments without tracking)
    if (tracking_number) {
      updateData.tracking_number = tracking_number;
    }
    // Auto-set printed_at if skipping from paid/processing to shipped
    if (order.status === 'paid' || order.status === 'processing') {
      updateData.printed_at = now;
    }
  }

  // Update order
  const { data: updatedOrder, error: updateError } = await supabaseAdmin
    .from('sticker_orders')
    .update(updateData)
    .eq('id', order.id)
    .select(
      `
      id,
      order_number,
      status,
      tracking_number,
      printed_at,
      shipped_at,
      updated_at
    `
    )
    .single();

  if (updateError) {
    console.error('Failed to update order:', updateError);
    return errorResponse('Failed to update order status', 500, isGet);
  }

  // When order is shipped, send notification and clean up PDF
  if (status === 'shipped') {
    const functionsUrl = `${supabaseUrl}/functions/v1`;

    // Send shipping notification email to user
    try {
      const emailResponse = await fetch(`${functionsUrl}/send-order-shipped`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ order_id: order.id }),
      });

      if (!emailResponse.ok) {
        const errorData = await emailResponse.json();
        console.error('Failed to send shipping notification:', errorData);
        // Continue anyway - email failure shouldn't block status update
      } else {
        console.log(`Shipping notification sent for order ${order.order_number}`);
      }
    } catch (err) {
      console.error('Error calling send-order-shipped:', err);
    }

    // Clean up PDF from storage (no longer needed after shipping)
    if (order.pdf_storage_path) {
      try {
        const { error: deleteError } = await supabaseAdmin.storage
          .from('sticker-pdfs')
          .remove([order.pdf_storage_path]);

        if (deleteError) {
          console.error('Failed to delete PDF:', deleteError);
        } else {
          console.log(`Deleted PDF: ${order.pdf_storage_path}`);

          // Clear the pdf_storage_path from the order
          await supabaseAdmin.from('sticker_orders').update({ pdf_storage_path: null }).eq('id', order.id);
        }
      } catch (err) {
        console.error('Error deleting PDF:', err);
      }
    }
  }

  // Redirect to web app for GET requests (opened in browser from email)
  if (isGet) {
    const redirectUrl = new URL(`${WEB_APP_URL}/order-updated`);
    redirectUrl.searchParams.set('order', updatedOrder?.order_number ?? '');
    redirectUrl.searchParams.set('status', updatedOrder?.status ?? '');

    return Response.redirect(redirectUrl.toString(), 302);
  }

  // Return JSON for POST requests
  return new Response(
    JSON.stringify({
      success: true,
      order: updatedOrder,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
