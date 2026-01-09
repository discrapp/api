import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser } from '../_shared/sentry.ts';

/**
 * Lookup QR Code Function
 *
 * Public endpoint (no auth required) that looks up a disc by its QR code.
 * Returns disc info for display to finders without exposing owner's private info.
 * If authenticated user is the owner, returns is_owner: true so app can redirect.
 *
 * GET /lookup-qr-code?code=ABC123
 *
 * Returns:
 * - found: boolean
 * - disc: { id, name, photo_url, owner_display_name, reward_amount } (if found)
 * - has_active_recovery: boolean (if found)
 * - is_owner: boolean (if authenticated and owns the disc)
 * - is_claimable: boolean (if disc has no owner and can be claimed)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://discrapp.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Get QR code from query params
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing code parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with service role key for read access
  // (bypasses RLS since this is a public lookup endpoint)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Check if user is authenticated (optional - for owner detection)
  let currentUserId: string | null = null;
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser();
    currentUserId = user?.id ?? null;

    // Set Sentry user context if authenticated
    if (currentUserId) {
      setUser(currentUserId);
    }
  }

  // Look up the QR code
  const { data: qrCode, error: qrError } = await supabase
    .from('qr_codes')
    .select('id, short_code, status, assigned_to')
    .eq('short_code', code.toUpperCase())
    .single();

  if (qrError || !qrCode) {
    return new Response(JSON.stringify({ found: false, qr_exists: false }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Check if QR code is deactivated
  if (qrCode.status === 'deactivated') {
    return new Response(
      JSON.stringify({
        found: false,
        qr_exists: true,
        qr_status: 'deactivated',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  // Check if QR code is unclaimed (generated status - no owner yet)
  if (qrCode.status === 'generated') {
    return new Response(
      JSON.stringify({
        found: false,
        qr_exists: true,
        qr_status: 'generated',
        qr_code: qrCode.short_code,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  // Check if QR code is assigned but not yet linked to a disc
  if (qrCode.status === 'assigned') {
    // Check if authenticated user is the assignee
    const isAssignee = currentUserId !== null && currentUserId === qrCode.assigned_to;
    return new Response(
      JSON.stringify({
        found: false,
        qr_exists: true,
        qr_status: 'assigned',
        qr_code: qrCode.short_code,
        qr_code_id: isAssignee ? qrCode.id : undefined, // Only return ID if user is assignee
        is_assignee: isAssignee,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  // QR code must be 'active' at this point - continue to look up the disc

  // OPTIMIZED: Single query with JOINs to fetch disc, owner profile, photos, and
  // active recovery events. This eliminates N+1 query issues by combining what
  // was previously 4 separate queries into 1.
  //
  // Previous queries (N+1 pattern):
  //   1. Disc lookup
  //   2. Profile lookup (N+1!)
  //   3. Recovery events lookup
  //
  // Optimized: Single query with embedded relations
  const { data: disc, error: discError } = await supabase
    .from('discs')
    .select(
      `
      id,
      name,
      manufacturer,
      mold,
      plastic,
      color,
      reward_amount,
      owner_id,
      photos:disc_photos(id, storage_path),
      owner:profiles!discs_owner_id_profiles_id_fk(
        email,
        username,
        full_name,
        display_preference
      ),
      active_recovery:recovery_events(id)
    `
    )
    .eq('qr_code_id', qrCode.id)
    // Filter recovery events to only active statuses
    .in('active_recovery.status', ['found', 'meetup_proposed', 'meetup_confirmed'])
    .maybeSingle();

  if (discError || !disc) {
    return new Response(JSON.stringify({ found: false }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Derive owner display name from joined profile data
  // If disc has no owner, it's claimable (was abandoned)
  let ownerDisplayName = 'Anonymous';
  const isClaimable = disc.owner_id === null;

  // Type the owner profile - Supabase returns different shapes depending on relationship
  // For belongs-to (one-to-one), it can return a single object or an array with one element
  type OwnerProfile = {
    email: string;
    username: string | null;
    full_name: string | null;
    display_preference: string | null;
  };
  let ownerProfile: OwnerProfile | null = null;
  if (disc.owner) {
    if (Array.isArray(disc.owner) && disc.owner.length > 0) {
      // Supabase returned an array (sometimes happens with explicit FK syntax)
      ownerProfile = disc.owner[0] as OwnerProfile;
    } else if (typeof disc.owner === 'object' && !Array.isArray(disc.owner)) {
      // Supabase returned a single object (typical for belongs-to relationships)
      ownerProfile = disc.owner as OwnerProfile;
    }
  }

  if (isClaimable) {
    ownerDisplayName = 'No Owner - Available to Claim';
  } else if (ownerProfile) {
    // Use display preference to determine what to show
    if (ownerProfile.display_preference === 'full_name' && ownerProfile.full_name) {
      ownerDisplayName = ownerProfile.full_name;
    } else if (ownerProfile.username) {
      ownerDisplayName = ownerProfile.username;
    } else if (ownerProfile.email) {
      // Fallback to email username part
      ownerDisplayName = ownerProfile.email.split('@')[0];
    }
  }

  // Check for active recovery from joined data
  const hasActiveRecovery = disc.active_recovery && disc.active_recovery.length > 0;

  // Get first photo URL if available
  let photoUrl = null;
  if (disc.photos && disc.photos.length > 0) {
    const { data: urlData } = await supabase.storage
      .from('disc-photos')
      .createSignedUrl(disc.photos[0].storage_path, 3600); // 1 hour expiry
    photoUrl = urlData?.signedUrl || null;
  }

  // Check if current user is the owner
  const isOwner = currentUserId !== null && currentUserId === disc.owner_id;

  // Return disc info without sensitive owner data
  return new Response(
    JSON.stringify({
      found: true,
      disc: {
        id: disc.id,
        name: disc.name,
        manufacturer: disc.manufacturer,
        mold: disc.mold,
        plastic: disc.plastic,
        color: disc.color,
        reward_amount: disc.reward_amount,
        owner_display_name: ownerDisplayName,
        photo_url: photoUrl,
      },
      has_active_recovery: hasActiveRecovery,
      is_owner: isOwner,
      is_claimable: isClaimable,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
