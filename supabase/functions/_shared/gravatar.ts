import { crypto } from 'https://deno.land/std@0.208.0/crypto/mod.ts';
import { encodeHex } from 'https://deno.land/std@0.208.0/encoding/hex.ts';

/**
 * Generate a Gravatar URL from an email address.
 *
 * @param email - The email address to generate the Gravatar URL for
 * @param size - The size of the avatar in pixels (default: 200)
 * @returns The Gravatar URL, or null if email is not provided
 */
export async function getGravatarUrl(email: string | null | undefined, size: number = 200): Promise<string | null> {
  if (!email) {
    return null;
  }

  // Normalize email: trim and lowercase
  const normalizedEmail = email.trim().toLowerCase();

  // Compute MD5 hash
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizedEmail);
  const hashBuffer = await crypto.subtle.digest('MD5', data);
  const hashHex = encodeHex(new Uint8Array(hashBuffer));

  // Return Gravatar URL with 404 fallback (so client can show placeholder)
  return `https://www.gravatar.com/avatar/${hashHex}?s=${size}&d=404`;
}
