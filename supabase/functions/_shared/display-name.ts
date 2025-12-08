interface ProfileData {
  username?: string | null;
  full_name?: string | null;
  display_preference?: 'username' | 'full_name' | null;
}

/**
 * Get the display name for a user based on their profile data and preferences.
 *
 * @param profile - The profile data containing username, full_name, and display_preference
 * @param fallback - The fallback name if no suitable display name is found (default: 'Someone')
 * @returns The formatted display name (username prefixed with @ or full_name)
 */
export function getDisplayName(profile: ProfileData | null, fallback: string = 'Someone'): string {
  if (!profile) {
    return fallback;
  }

  // If user prefers full_name and has one, use it
  if (profile.display_preference === 'full_name' && profile.full_name) {
    return profile.full_name;
  }

  // Otherwise, prefer username with @ prefix
  if (profile.username) {
    return `@${profile.username}`;
  }

  // Fallback to full_name if available
  if (profile.full_name) {
    return profile.full_name;
  }

  return fallback;
}

/**
 * Fetch and return the display name for a user from the database.
 *
 * @param supabaseAdmin - The Supabase admin client with service role
 * @param userId - The user ID to fetch the profile for
 * @param fallback - The fallback name if profile is not found (default: 'Someone')
 * @returns The formatted display name
 */
export async function fetchDisplayName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  fallback: string = 'Someone'
): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('username, full_name, display_preference')
    .eq('id', userId)
    .single();

  return getDisplayName(profile, fallback);
}
