#!/usr/bin/env -S deno run --allow-write --allow-net --allow-env --allow-read

/**
 * Demo Sticker PDF Generator
 *
 * Generates a PDF with 5 real QR codes that are inserted into the database.
 * Uses the new sticker design: logo, purple QR code, two-line code text.
 *
 * IMPORTANT: This script reuses existing demo codes if they exist (stored in demo-codes.json).
 * This prevents orphaning QR codes in the database when regenerating the PDF.
 *
 * Run with: deno run --allow-write --allow-net --allow-env --allow-read scripts/generate-demo-stickers.ts
 *
 * Requires .env file with:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Output: demo-stickers.pdf in current directory
 */

import { config } from 'https://deno.land/x/dotenv@v3.2.2/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import QRCode from 'https://esm.sh/qrcode@1.5.3';
import { LOGO_BASE64 } from '../supabase/functions/generate-sticker-pdf/logo-data.ts';

// Load environment variables
const env = config();
const SUPABASE_URL = env.SUPABASE_URL || Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  Deno.exit(1);
}

// File to store demo codes for reuse
const DEMO_CODES_FILE = 'scripts/demo-codes.json';

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
const STICKER_WIDTH = 108; // 1.5 inches
const STICKER_HEIGHT = 144; // 2 inches
const INNER_MARGIN = 8; // Margin inside the cut line
const CONTENT_WIDTH = STICKER_WIDTH - INNER_MARGIN * 2 - 4; // ~88pt usable width
const QR_SIZE = 58; // Smaller QR to fit
const PAGE_MARGIN = 36; // 0.5 inch margin
const NUM_STICKERS = 5;

// Brand colors
const PURPLE = { r: 0.243, g: 0.114, b: 0.467 }; // #3e1d77

// App URL for QR codes
const APP_URL = 'https://discrapp.com/d';

// Generate short codes using the same algorithm as production (uppercase only)
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHORT_CODE_LENGTH = 12;

function generateShortCode(): string {
  let result = '';
  const randomValues = new Uint32Array(SHORT_CODE_LENGTH);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    result += SHORT_CODE_ALPHABET[randomValues[i] % SHORT_CODE_ALPHABET.length];
  }
  return result;
}

async function loadExistingCodes(): Promise<string[] | null> {
  try {
    const content = await Deno.readTextFile(DEMO_CODES_FILE);
    const data = JSON.parse(content);
    if (Array.isArray(data.codes) && data.codes.length === NUM_STICKERS) {
      return data.codes;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

async function saveCodes(codes: string[]): Promise<void> {
  const data = { codes, createdAt: new Date().toISOString() };
  await Deno.writeTextFile(DEMO_CODES_FILE, JSON.stringify(data, null, 2));
}

async function main() {
  console.log('🎨 Generating demo sticker PDF...\n');

  // Create Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Try to load existing codes first
  let shortCodes = await loadExistingCodes();
  let codesAreNew = false;

  if (shortCodes) {
    console.log('♻️  Reusing existing demo codes from demo-codes.json');

    // Verify they still exist in database
    const { data: existingCodes } = await supabase.from('qr_codes').select('short_code').in('short_code', shortCodes);

    const existingSet = new Set(existingCodes?.map((c) => c.short_code) || []);
    const allExist = shortCodes.every((code) => existingSet.has(code));

    if (!allExist) {
      console.log('⚠️  Some codes missing from database, will create new ones');
      shortCodes = null;
    }
  }

  if (!shortCodes) {
    // Generate new codes
    shortCodes = [];
    for (let i = 0; i < NUM_STICKERS; i++) {
      shortCodes.push(generateShortCode());
    }
    codesAreNew = true;

    console.log('📝 Generated new short codes:');
    shortCodes.forEach((code, i) => console.log(`   ${i + 1}. ${code}`));

    // Check for collisions
    const { data: existingCodes } = await supabase.from('qr_codes').select('short_code').in('short_code', shortCodes);

    if (existingCodes && existingCodes.length > 0) {
      console.error('❌ Code collision detected. Please run again.');
      Deno.exit(1);
    }

    // Insert QR codes into database
    console.log('\n💾 Inserting QR codes into database...');
    const qrCodeData = shortCodes.map((code) => ({
      short_code: code,
      status: 'generated',
    }));

    const { data: insertedCodes, error: insertError } = await supabase.from('qr_codes').insert(qrCodeData).select();

    if (insertError) {
      console.error('❌ Failed to insert QR codes:', insertError.message);
      Deno.exit(1);
    }

    console.log(`✅ Inserted ${insertedCodes?.length} QR codes into database`);

    // Save codes for future runs
    await saveCodes(shortCodes);
    console.log(`💾 Saved codes to ${DEMO_CODES_FILE} for future regeneration`);
  }

  console.log('\n📝 Using codes:');
  shortCodes.forEach((code, i) => console.log(`   ${i + 1}. ${code}`));

  // Create PDF document
  console.log('\n📄 Generating PDF...');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Load and embed logo
  const logoBytes = Uint8Array.from(atob(LOGO_BASE64.trim()), (c) => c.charCodeAt(0));
  const logoImage = await pdfDoc.embedPng(logoBytes);

  // Page size (Letter: 612 x 792 points)
  const pageWidth = 612;
  const pageHeight = 792;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // Center the row of stickers
  const totalWidth = NUM_STICKERS * STICKER_WIDTH;
  const startX = (pageWidth - totalWidth) / 2;
  const startY = pageHeight - PAGE_MARGIN - STICKER_HEIGHT;

  for (let i = 0; i < NUM_STICKERS; i++) {
    const shortCode = shortCodes[i];
    const x = startX + i * STICKER_WIDTH;
    const y = startY;

    // Inner content area (inside the cut line with margins)
    // These are kept for documentation/future use
    const _contentX = x + INNER_MARGIN + 2;
    const _contentY = y + INNER_MARGIN + 2;
    const _contentHeight = STICKER_HEIGHT - INNER_MARGIN * 2 - 4;

    // Draw logo at top (scaled to fit content width)
    const logoTargetWidth = Math.min(CONTENT_WIDTH - 10, 60);
    const logoScale = logoTargetWidth / logoImage.width;
    const logoHeight = logoImage.height * logoScale;
    const logoX = x + (STICKER_WIDTH - logoTargetWidth) / 2;
    const logoY = y + STICKER_HEIGHT - INNER_MARGIN - 6 - logoHeight;

    page.drawImage(logoImage, {
      x: logoX,
      y: logoY,
      width: logoTargetWidth,
      height: logoHeight,
    });

    // Generate QR code URL
    const qrUrl = `${APP_URL}/${shortCode}`;

    // Generate QR code as data URL (purple color)
    const qrDataUrl = await QR.toDataURL(qrUrl, {
      width: QR_SIZE * 4, // Higher resolution
      margin: 1,
      color: {
        dark: '#3e1d77', // Purple
        light: '#FFFFFF',
      },
    });

    // Convert data URL to bytes and embed
    const qrBase64 = qrDataUrl.split(',')[1];
    const qrBytes = Uint8Array.from(atob(qrBase64), (c) => c.charCodeAt(0));
    const qrImage = await pdfDoc.embedPng(qrBytes);

    // Calculate QR code position (centered, below logo with gap)
    const qrX = x + (STICKER_WIDTH - QR_SIZE) / 2;
    const qrY = logoY - 6 - QR_SIZE;

    page.drawImage(qrImage, {
      x: qrX,
      y: qrY,
      width: QR_SIZE,
      height: QR_SIZE,
    });

    // Draw "Code:" label (smaller, regular weight)
    const labelSize = 6;
    const labelText = 'Code:';
    const labelWidth = fontRegular.widthOfTextAtSize(labelText, labelSize);
    const labelX = x + (STICKER_WIDTH - labelWidth) / 2;
    const labelY = qrY - 10;

    page.drawText(labelText, {
      x: labelX,
      y: labelY,
      size: labelSize,
      font: fontRegular,
      color: rgb(PURPLE.r, PURPLE.g, PURPLE.b),
    });

    // Draw code (bold, uppercase) - smaller font to fit
    const codeSize = 5.5;
    const codeText = shortCode.toUpperCase();
    const codeWidth = font.widthOfTextAtSize(codeText, codeSize);
    const codeX = x + (STICKER_WIDTH - codeWidth) / 2;
    const codeY = labelY - 8;

    page.drawText(codeText, {
      x: codeX,
      y: codeY,
      size: codeSize,
      font: font,
      color: rgb(PURPLE.r, PURPLE.g, PURPLE.b),
    });

    // Draw cut line (magenta for PerfCutContour)
    page.drawRectangle({
      x: x + 2,
      y: y + 2,
      width: STICKER_WIDTH - 4,
      height: STICKER_HEIGHT - 4,
      borderColor: rgb(1, 0, 1), // Magenta
      borderWidth: 0.5,
    });
  }

  // Add metadata
  pdfDoc.setTitle('Demo Stickers');
  pdfDoc.setSubject(`Demo stickers - ${NUM_STICKERS} stickers`);
  pdfDoc.setCreator('Discr');
  pdfDoc.setProducer('Discr Demo Sticker Generator');

  // Save PDF
  const pdfBytes = await pdfDoc.save();
  const outputPath = 'demo-stickers.pdf';

  await Deno.writeFile(outputPath, pdfBytes);

  console.log(`\n✅ PDF generated: ${outputPath}`);
  console.log(`   File size: ${(pdfBytes.length / 1024).toFixed(1)} KB`);
  console.log(`\n🔗 QR codes link to:`);
  shortCodes.forEach((code) => console.log(`   ${APP_URL}/${code}`));
  console.log(`\n📱 Scan any QR code to test!`);

  if (!codesAreNew) {
    console.log(`\n♻️  To generate NEW codes, delete ${DEMO_CODES_FILE} and run again.`);
  }
}

// Run
main().catch((err) => {
  console.error('❌ Error:', err);
  Deno.exit(1);
});
