/**
 * Short Code Generation Utility
 *
 * Generates unique alphanumeric short codes for QR codes.
 * Uses uppercase only for consistency with printed stickers.
 * Excludes ambiguous characters (0, O, 1, I).
 */

// Uppercase alphabet excluding ambiguous characters (0, O, 1, I)
// Upper: ABCDEFGHJKLMNPQRSTUVWXYZ (24 chars - no I, O)
// Numbers: 23456789 (8 chars - no 0, 1)
// Total: 32 characters = 32^12 ≈ 1.2 × 10^18 combinations
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

/**
 * Generate a random short code
 * @returns A random 12-character alphanumeric string
 */
export function generateShortCode(): string {
  let result = '';
  const randomValues = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < CODE_LENGTH; i++) {
    result += ALPHABET[randomValues[i] % ALPHABET.length];
  }

  return result;
}

/**
 * Batch generate unique short codes
 * @param count Number of codes to generate
 * @returns Array of unique short codes
 */
export function generateShortCodes(count: number): string[] {
  const codes = new Set<string>();

  while (codes.size < count) {
    codes.add(generateShortCode());
  }

  return Array.from(codes);
}
