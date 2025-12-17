#!/usr/bin/env -S deno run --allow-write --allow-net

/**
 * Test Sticker PDF Generator
 *
 * Generates a sample sticker PDF for testing layout and design.
 * Run with: deno run --allow-write --allow-net scripts/generate-test-sticker-pdf.ts
 *
 * Output: test-stickers.pdf in current directory
 */

import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

// Type declarations for QRCode library
interface QRCodeOptions {
  width?: number;
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
}

interface QRCodeModule {
  toDataURL(text: string, options?: QRCodeOptions): Promise<string>;
}

const QR: QRCodeModule = QRCode as QRCodeModule;

// Sticker dimensions in points (72 points = 1 inch)
const STICKER_WIDTH = 144; // 2 inches
const STICKER_HEIGHT = 144; // 2 inches
const QR_SIZE = 85; // QR code size in points
const MARGIN = 10;
const PAGE_MARGIN = 36; // 0.5 inch margin
const STICKERS_PER_ROW = 4;
const STICKERS_PER_COL = 5;

// App URL for QR codes
const APP_URL = 'https://aceback.app/d';

// Generate random short codes using the same algorithm as production
// Mixed-case alphabet excluding ambiguous characters (0, O, o, 1, l, I, i)
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SHORT_CODE_LENGTH = 12;

function generateTestCode(): string {
  let result = '';
  const randomValues = new Uint32Array(SHORT_CODE_LENGTH);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    result += SHORT_CODE_ALPHABET[randomValues[i] % SHORT_CODE_ALPHABET.length];
  }
  return result;
}

// Generate 20 random test codes for a full page
const TEST_CODES: string[] = [];
for (let i = 0; i < 20; i++) {
  TEST_CODES.push(generateTestCode());
}

async function generateTestPdf() {
  console.log('🎨 Generating test sticker PDF...\n');

  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Page size (Letter: 612 x 792 points)
  const pageWidth = 612;
  const pageHeight = 792;

  // Calculate how many stickers we can fit
  const stickersPerPage = STICKERS_PER_ROW * STICKERS_PER_COL;
  const numPages = Math.ceil(TEST_CODES.length / stickersPerPage);

  console.log(`📄 Creating ${numPages} page(s) with ${TEST_CODES.length} stickers`);
  console.log(
    `📐 Sticker size: ${STICKER_WIDTH / 72}" x ${STICKER_HEIGHT / 72}" (${STICKER_WIDTH}pt x ${STICKER_HEIGHT}pt)`
  );
  console.log(`📐 Grid: ${STICKERS_PER_ROW} x ${STICKERS_PER_COL} per page\n`);

  for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const startIdx = pageIdx * stickersPerPage;
    const endIdx = Math.min(startIdx + stickersPerPage, TEST_CODES.length);

    console.log(`  Page ${pageIdx + 1}: Stickers ${startIdx + 1} to ${endIdx}`);

    for (let i = startIdx; i < endIdx; i++) {
      const shortCode = TEST_CODES[i];
      const localIdx = i - startIdx;
      const row = Math.floor(localIdx / STICKERS_PER_ROW);
      const col = localIdx % STICKERS_PER_ROW;

      // Calculate position (from top-left)
      const x = PAGE_MARGIN + col * STICKER_WIDTH;
      const y = pageHeight - PAGE_MARGIN - (row + 1) * STICKER_HEIGHT;

      // Generate QR code URL
      const qrUrl = `${APP_URL}/${shortCode}`;

      // Generate QR code as data URL
      const qrDataUrl = await QR.toDataURL(qrUrl, {
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

      // Calculate QR code position (centered horizontally)
      const qrX = x + (STICKER_WIDTH - QR_SIZE) / 2;
      const qrY = y + STICKER_HEIGHT - MARGIN - QR_SIZE;

      // Draw QR code
      page.drawImage(qrImage, {
        x: qrX,
        y: qrY,
        width: QR_SIZE,
        height: QR_SIZE,
      });

      // Draw "AceBack" text below QR code
      // TODO: Replace with logo image when available
      const textSize = 14;
      const text = 'AceBack';
      const textWidth = font.widthOfTextAtSize(text, textSize);
      const textX = x + (STICKER_WIDTH - textWidth) / 2;
      const textY = y + MARGIN + 18;

      page.drawText(text, {
        x: textX,
        y: textY,
        size: textSize,
        font: font,
        color: rgb(0, 0, 0),
      });

      // Draw URL below brand name
      const codeSize = 6;
      const codeText = `aceback.app/d/${shortCode}`;
      const codeWidth = font.widthOfTextAtSize(codeText, codeSize);
      const codeX = x + (STICKER_WIDTH - codeWidth) / 2;
      const codeY = textY - 12;

      page.drawText(codeText, {
        x: codeX,
        y: codeY,
        size: codeSize,
        font: font,
        color: rgb(0.5, 0.5, 0.5),
      });

      // Draw cut line rectangle (PerfCutContour placeholder)
      // Using magenta as placeholder - actual spot color set in print workflow
      page.drawRectangle({
        x: x + 2,
        y: y + 2,
        width: STICKER_WIDTH - 4,
        height: STICKER_HEIGHT - 4,
        borderColor: rgb(1, 0, 1), // Magenta
        borderWidth: 0.5,
      });
    }
  }

  // Add metadata
  pdfDoc.setTitle('Test Sticker Sheet');
  pdfDoc.setSubject(`Test stickers - ${TEST_CODES.length} stickers`);
  pdfDoc.setCreator('AceBack');
  pdfDoc.setProducer('AceBack Sticker Generator (Test)');

  // Save PDF
  const pdfBytes = await pdfDoc.save();
  const outputPath = 'test-stickers.pdf';

  await Deno.writeFile(outputPath, pdfBytes);

  console.log(`\n✅ PDF generated: ${outputPath}`);
  console.log(`   File size: ${(pdfBytes.length / 1024).toFixed(1)} KB`);
  console.log(`\n📝 Notes:`);
  console.log(`   - Magenta lines are PerfCutContour cut marks`);
  console.log(`   - "AceBack" text is placeholder for logo`);
  console.log(`   - QR codes link to ${APP_URL}/{code}`);
}

// Run
generateTestPdf().catch(console.error);
