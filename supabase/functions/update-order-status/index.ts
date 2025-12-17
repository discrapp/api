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
const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending_payment: [], // Can't transition from pending_payment via this endpoint
  paid: ['processing', 'printed'], // Can go to processing or skip to printed
  processing: ['printed'],
  printed: ['shipped'],
  shipped: ['delivered'],
  delivered: [], // Terminal state
  cancelled: [], // Terminal state
};

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

  const { printer_token, status, tracking_number } = body;

  // Validate required fields
  if (!printer_token) {
    return new Response(JSON.stringify({ error: 'Missing required field: printer_token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!status) {
    return new Response(JSON.stringify({ error: 'Missing required field: status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate status value
  if (!VALID_STATUSES.includes(status)) {
    return new Response(JSON.stringify({ error: 'Invalid status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Require tracking_number for shipped status
  if (status === 'shipped' && !tracking_number) {
    return new Response(JSON.stringify({ error: 'tracking_number is required when marking as shipped' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
    return new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate status transition
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  if (!allowedTransitions.includes(status)) {
    return new Response(
      JSON.stringify({
        error: `Invalid status transition from ${order.status} to ${status}`,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Build update object
  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  // Set timestamp fields based on status
  if (status === 'printed') {
    updateData.printed_at = new Date().toISOString();
  } else if (status === 'shipped') {
    updateData.shipped_at = new Date().toISOString();
    updateData.tracking_number = tracking_number;
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
    return new Response(JSON.stringify({ error: 'Failed to update order status' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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
