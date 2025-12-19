import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
} from 'npm:@imagemagick/magick-wasm@0.0.30';

// Initialize ImageMagick WASM - must be called before using ImageMagick
let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;

  const wasmBytes = await Deno.readFile(
    new URL('magick.wasm', import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.30'))
  );
  await initializeImageMagick(wasmBytes);
  initialized = true;
}

export interface CompressionOptions {
  /** Maximum dimension (width or height) - default 1920 */
  maxDimension?: number;
  /** JPEG quality (1-100) - default 85 */
  quality?: number;
  /** Minimum file size to trigger compression (bytes) - default 500KB */
  minSizeToCompress?: number;
  /** Strip EXIF/metadata - default true */
  stripMetadata?: boolean;
}

export interface CompressionResult {
  /** Compressed image data */
  data: Uint8Array;
  /** Output MIME type (always image/jpeg) */
  mimeType: 'image/jpeg';
  /** Whether compression was applied */
  wasCompressed: boolean;
  /** Original file size */
  originalSize: number;
  /** Final file size */
  finalSize: number;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxDimension: 1920,
  quality: 85,
  minSizeToCompress: 500 * 1024, // 500KB
  stripMetadata: true,
};

/**
 * Compresses and optimizes an image for storage.
 *
 * - Resizes to max dimension while maintaining aspect ratio
 * - Converts to JPEG format
 * - Strips EXIF metadata (preserves orientation correction)
 * - Only compresses if file is above minimum size threshold
 *
 * @param imageData - Raw image bytes
 * @param options - Compression options
 * @returns Compression result with optimized image data
 */
export async function compressImage(
  imageData: Uint8Array,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalSize = imageData.length;

  // Skip compression if file is small enough
  if (originalSize < opts.minSizeToCompress) {
    return {
      data: imageData,
      mimeType: 'image/jpeg',
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  }

  await ensureInitialized();

  const compressedData = ImageMagick.read(imageData, (img): Uint8Array => {
    // Auto-orient based on EXIF (before stripping metadata)
    img.autoOrient();

    // Strip metadata if requested
    if (opts.stripMetadata) {
      img.strip();
    }

    // Resize if larger than max dimension
    const width = img.width;
    const height = img.height;
    const maxDim = Math.max(width, height);

    if (maxDim > opts.maxDimension) {
      // Calculate new dimensions maintaining aspect ratio
      const scale = opts.maxDimension / maxDim;
      const newWidth = Math.round(width * scale);
      const newHeight = Math.round(height * scale);
      img.resize(new MagickGeometry(newWidth, newHeight));
    }

    // Set JPEG quality
    img.quality = opts.quality;

    // Write as JPEG
    return img.write(MagickFormat.Jpeg, (data) => new Uint8Array(data));
  });

  return {
    data: compressedData,
    mimeType: 'image/jpeg',
    wasCompressed: true,
    originalSize,
    finalSize: compressedData.length,
  };
}

/**
 * Compresses an image from a File object.
 *
 * @param file - File object from form data
 * @param options - Compression options
 * @returns Compression result with optimized image data
 */
export async function compressImageFile(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const imageData = new Uint8Array(arrayBuffer);
  return compressImage(imageData, options);
}
