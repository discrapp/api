import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import QRCode from 'https://esm.sh/qrcode@1.5.3';
import { LOGO_BASE64 } from './logo-data.ts';

/**
 * Generate Sticker PDF Function
 *
 * Generates a print-ready PDF with QR code stickers for an order.
 * Includes PerfCutContour spot color for Roland VersaWorks cut lines.
 *
 * POST /generate-sticker-pdf
 * Body: { order_id: string }
 *
 * Returns:
 * - PDF URL for download
 * - Storage path
 */

// Sticker dimensions in points (72 points = 1 inch)
const STICKER_WIDTH = 144; // 2 inches
const STICKER_HEIGHT = 144; // 2 inches
const QR_SIZE = 85; // QR code size in points
const MARGIN = 10;
const PAGE_MARGIN = 36; // 0.5 inch margin
const STICKERS_PER_ROW = 4;
const STICKERS_PER_COL = 5;

// Note: PerfCutContour spot color for Roland VersaWorks
// Currently using magenta RGB as placeholder - actual spot color
// needs to be set up in print workflow

// App URL for QR codes
const APP_URL = 'https://aceback.app/d';

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

  // Get order with QR codes
  const { data: order, error: orderError } = await supabaseAdmin
    .from('sticker_orders')
    .select(
      `
      id,
      user_id,
      order_number,
      quantity,
      status,
      pdf_storage_path,
      items:sticker_order_items(
        qr_code:qr_codes(
          id,
          short_code
        )
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

  // Check if PDF already exists
  if (order.pdf_storage_path) {
    return new Response(JSON.stringify({ error: 'PDF already generated for this order' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if order has QR codes
  // Handle both array and single object responses for qr_code relation
  const qrCodes = order.items
    .map((item: { qr_code: { id: string; short_code: string }[] | { id: string; short_code: string } | null }) => {
      if (Array.isArray(item.qr_code)) {
        return item.qr_code[0] || null;
      }
      return item.qr_code;
    })
    .filter((qr: { id: string; short_code: string } | null): qr is { id: string; short_code: string } => qr !== null);

  if (!qrCodes || qrCodes.length === 0) {
    return new Response(JSON.stringify({ error: 'No QR codes found for this order' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Load and embed logo from base64
    const logoBytes = Uint8Array.from(atob(LOGO_BASE64.trim()), (c) => c.charCodeAt(0));
    const logoImage = await pdfDoc.embedPng(logoBytes);

    // Calculate page size (Letter: 612 x 792 points)
    const pageWidth = 612;
    const pageHeight = 792;

    // Calculate sticker positions
    const stickersPerPage = STICKERS_PER_ROW * STICKERS_PER_COL;
    const numPages = Math.ceil(qrCodes.length / stickersPerPage);

    for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const startIdx = pageIdx * stickersPerPage;
      const endIdx = Math.min(startIdx + stickersPerPage, qrCodes.length);

      for (let i = startIdx; i < endIdx; i++) {
        const qrCode = qrCodes[i] as { id: string; short_code: string };
        const localIdx = i - startIdx;
        const row = Math.floor(localIdx / STICKERS_PER_ROW);
        const col = localIdx % STICKERS_PER_ROW;

        // Calculate position (from top-left)
        const x = PAGE_MARGIN + col * STICKER_WIDTH;
        const y = pageHeight - PAGE_MARGIN - (row + 1) * STICKER_HEIGHT;

        // Generate QR code URL
        const qrUrl = `${APP_URL}/${qrCode.short_code}`;

        // Generate QR code as data URL
        const qrDataUrl = await QRCode.toDataURL(qrUrl, {
          width: QR_SIZE * 2, // Higher resolution for quality
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });

        // Convert data URL to bytes
        const qrBase64 = qrDataUrl.split(',')[1];
        const qrBytes = Uint8Array.from(atob(qrBase64), (c) => c.charCodeAt(0));

        // Embed QR code image
        const qrImage = await pdfDoc.embedPng(qrBytes);

        // Draw logo at top (scaled to fit width with aspect ratio preserved)
        const logoHeight = 24; // Target height for logo
        const logoDims = logoImage.scale(logoHeight / logoImage.height);
        const logoX = x + (STICKER_WIDTH - logoDims.width) / 2;
        const logoY = y + STICKER_HEIGHT - MARGIN - logoHeight;

        page.drawImage(logoImage, {
          x: logoX,
          y: logoY,
          width: logoDims.width,
          height: logoDims.height,
        });

        // Calculate QR code position (centered, below logo)
        const qrX = x + (STICKER_WIDTH - QR_SIZE) / 2;
        const qrY = logoY - 8 - QR_SIZE; // 8pt spacing below logo

        // Draw QR code
        page.drawImage(qrImage, {
          x: qrX,
          y: qrY,
          width: QR_SIZE,
          height: QR_SIZE,
        });

        // Draw URL below QR code
        const codeSize = 7;
        const codeText = `aceback.app/d/${qrCode.short_code}`;
        const codeWidth = font.widthOfTextAtSize(codeText, codeSize);
        const codeX = x + (STICKER_WIDTH - codeWidth) / 2;
        const codeY = qrY - 10; // 10pt below QR code

        page.drawText(codeText, {
          x: codeX,
          y: codeY,
          size: codeSize,
          font: font,
          color: rgb(0.4, 0.4, 0.4),
        });

        // Draw cut line rectangle
        // Note: For actual PerfCutContour spot color, this would need to be done
        // with a spot color separation. For now, we use a magenta outline as a
        // placeholder that can be converted in the print workflow.
        // In Roland VersaWorks, you'd create a spot color named "PerfCutContour"
        page.drawRectangle({
          x: x + 2,
          y: y + 2,
          width: STICKER_WIDTH - 4,
          height: STICKER_HEIGHT - 4,
          borderColor: rgb(1, 0, 1), // Magenta as placeholder for PerfCutContour
          borderWidth: 0.5,
        });
      }
    }

    // Add metadata
    pdfDoc.setTitle(`Sticker Order ${order.order_number}`);
    pdfDoc.setSubject(`QR Code Stickers - ${qrCodes.length} stickers`);
    pdfDoc.setCreator('AceBack');
    pdfDoc.setProducer('AceBack Sticker Generator');

    // Save PDF
    const pdfBytes = await pdfDoc.save();

    // Upload to storage
    const storagePath = `orders/${order.user_id}/${order.order_number}.pdf`;

    const { error: uploadError } = await supabaseAdmin.storage.from('sticker-pdfs').upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true, // Allow overwriting existing PDFs
    });

    if (uploadError) {
      console.error('Failed to upload PDF:', uploadError);
      return new Response(JSON.stringify({ error: 'Failed to upload PDF' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update order with PDF path
    const { error: updateError } = await supabaseAdmin
      .from('sticker_orders')
      .update({
        pdf_storage_path: storagePath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id);

    if (updateError) {
      console.error('Failed to update order:', updateError);
    }

    // Generate signed URL for download
    const { data: signedUrl } = await supabaseAdmin.storage.from('sticker-pdfs').createSignedUrl(storagePath, 3600); // 1 hour expiry

    return new Response(
      JSON.stringify({
        success: true,
        pdf_url: signedUrl?.signedUrl,
        pdf_storage_path: storagePath,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Failed to generate PDF:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate PDF' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
