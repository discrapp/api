import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { withRateLimit, RateLimitPresets } from '../_shared/with-rate-limit.ts';
import { setUser, captureException } from '../_shared/sentry.ts';

/**
 * Lookup User by Phone Function
 *
 * Searches for a user by their phone number (respecting privacy settings).
 * Only returns user info if they have phone_discoverable enabled.
 *
 * POST /lookup-user-by-phone
 * Body: { phone_number: string }
 *
 * Returns:
 * - found: boolean - Whether a user with this phone exists
 * - discoverable: boolean - Whether the user allows phone lookup
 * - user: User info (only if discoverable)
 * - discs: User's registered discs (only if discoverable)
 */

interface RequestBody {
  phone_number: string;
}

interface UserDisc {
  id: string;
  name: string;
  manufacturer: string | null;
  mold: string | null;
  color: string | null;
  photo_url: string | null;
}

/**
 * Normalize phone number to E.164 format (+1XXXXXXXXXX for US)
 */
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If starts with +, keep it; otherwise add +1 for US
  if (!cleaned.startsWith('+')) {
    // Handle various US formats
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    }
  }

  return cleaned;
}

/**
 * Validate phone number format
 */
function isValidPhoneNumber(phone: string): boolean {
  // E.164 format: + followed by 10-15 digits
  const normalized = normalizePhoneNumber(phone);
  return /^\+\d{10,15}$/.test(normalized);
}

const handler = async (req: Request): Promise<Response> => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client for auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // Verify user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Set Sentry user context
  setUser(user.id);

  // Parse request body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate phone number
  if (!body.phone_number || typeof body.phone_number !== 'string') {
    return new Response(JSON.stringify({ error: 'phone_number is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const normalizedPhone = normalizePhoneNumber(body.phone_number);

  if (!isValidPhoneNumber(body.phone_number)) {
    return new Response(JSON.stringify({ error: 'Invalid phone number format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create service role client for lookups (bypasses RLS)
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Look up user by normalized phone number
    const { data: matchedUser, error: lookupError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, full_name, display_preference, phone_discoverable')
      .eq('phone_number', normalizedPhone)
      .single();

    // Log the lookup attempt
    await supabaseAdmin.from('phone_lookup_logs').insert({
      finder_id: user.id,
      searched_phone: body.phone_number,
      normalized_phone: normalizedPhone,
      matched_user_id: matchedUser?.id || null,
      was_discoverable: matchedUser?.phone_discoverable || null,
    });

    // No user found with this phone number
    if (lookupError || !matchedUser) {
      return new Response(
        JSON.stringify({
          found: false,
          discoverable: false,
          message: 'No user found with this phone number',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // User found but not discoverable
    if (!matchedUser.phone_discoverable) {
      return new Response(
        JSON.stringify({
          found: true,
          discoverable: false,
          message: 'User found but has not enabled phone lookup',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // User found and discoverable - get their discs
    const { data: discs } = await supabaseAdmin
      .from('discs')
      .select(
        `
        id,
        name,
        manufacturer,
        mold,
        color,
        disc_photos(storage_path)
      `
      )
      .eq('owner_id', matchedUser.id)
      .order('created_at', { ascending: false });

    // Generate signed URLs for disc photos
    const discsWithPhotos: UserDisc[] = await Promise.all(
      (discs || []).map(async (disc) => {
        let photoUrl: string | null = null;

        // Get first photo if available
        const photos = disc.disc_photos as Array<{ storage_path: string }> | null;
        if (photos && photos.length > 0) {
          const { data: signedUrl } = await supabaseAdmin.storage
            .from('disc-photos')
            .createSignedUrl(photos[0].storage_path, 3600);
          photoUrl = signedUrl?.signedUrl || null;
        }

        return {
          id: disc.id,
          name: disc.name,
          manufacturer: disc.manufacturer,
          mold: disc.mold,
          color: disc.color,
          photo_url: photoUrl,
        };
      })
    );

    // Determine display name based on preference
    let displayName = matchedUser.username;
    if (matchedUser.display_preference === 'full_name' && matchedUser.full_name) {
      displayName = matchedUser.full_name;
    }

    return new Response(
      JSON.stringify({
        found: true,
        discoverable: true,
        user: {
          id: matchedUser.id,
          display_name: displayName,
          disc_count: discsWithPhotos.length,
        },
        discs: discsWithPhotos,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Lookup error:', error);
    captureException(error, {
      operation: 'lookup-user-by-phone',
      userId: user.id,
    });
    return new Response(JSON.stringify({ error: 'Phone lookup failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withSentry(withRateLimit(handler, RateLimitPresets.auth)));
