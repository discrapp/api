import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getGravatarUrl } from './gravatar.ts';

const SIGNED_URL_EXPIRY = 3600; // 1 hour in seconds

/**
 * Resolve the avatar URL for a user.
 * If the user has a custom profile photo, returns a signed URL.
 * Otherwise, falls back to Gravatar.
 *
 * @param email - The user's email address (for Gravatar fallback)
 * @param avatarStoragePath - The storage path of the custom avatar (e.g., "abc123.jpg")
 * @param supabaseAdmin - Supabase client with service role for signed URL generation
 * @param size - The size of the avatar in pixels (default: 200)
 * @returns The avatar URL (signed URL or Gravatar URL), or null if neither available
 */
export async function resolveAvatarUrl(
  email: string | null | undefined,
  avatarStoragePath: string | null | undefined,
  supabaseAdmin: SupabaseClient,
  size: number = 200
): Promise<string | null> {
  // If user has a custom avatar, generate signed URL
  if (avatarStoragePath) {
    const { data } = await supabaseAdmin.storage
      .from('profile-photos')
      .createSignedUrl(avatarStoragePath, SIGNED_URL_EXPIRY);

    if (data?.signedUrl) {
      return data.signedUrl;
    }
    // If signed URL fails, fall through to Gravatar
  }

  // Fall back to Gravatar
  return getGravatarUrl(email, size);
}
