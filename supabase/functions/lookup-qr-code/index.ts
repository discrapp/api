import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Lookup QR Code Function
 *
 * Public endpoint (no auth required) that looks up a disc by its QR code.
 * Returns disc info for display to finders without exposing owner's private info.
 *
 * GET /lookup-qr-code?code=ABC123
 *
 * Returns:
 * - found: boolean
 * - disc: { name, photo_url, owner_display_name, reward_amount } (if found)
 * - has_active_recovery: boolean (if found)
 */

Deno.serve(async (req) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get QR code from query params
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing code parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with service role key for read access
  // (bypasses RLS since this is a public lookup endpoint)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up the QR code
  const { data: qrCode, error: qrError } = await supabase
    .from('qr_codes')
    .select('id, short_code, status, assigned_to')
    .eq('short_code', code.toUpperCase())
    .single();

  if (qrError || !qrCode) {
    return new Response(JSON.stringify({ found: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if QR code is assigned (has a disc)
  if (qrCode.status !== 'assigned' && qrCode.status !== 'active') {
    return new Response(JSON.stringify({ found: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get the disc associated with this QR code
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
      owner:profiles!discs_owner_id_profiles_id_fk(display_name),
      photos:disc_photos(id, storage_path)
    `
    )
    .eq('qr_code_id', qrCode.id)
    .single();

  if (discError || !disc) {
    return new Response(JSON.stringify({ found: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for active recovery events
  const { data: activeRecovery } = await supabase
    .from('recovery_events')
    .select('id')
    .eq('disc_id', disc.id)
    .in('status', ['found', 'meetup_proposed', 'meetup_confirmed'])
    .limit(1)
    .maybeSingle();

  // Get first photo URL if available
  let photoUrl = null;
  if (disc.photos && disc.photos.length > 0) {
    const { data: urlData } = await supabase.storage
      .from('disc-photos')
      .createSignedUrl(disc.photos[0].storage_path, 3600); // 1 hour expiry
    photoUrl = urlData?.signedUrl || null;
  }

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
        owner_display_name: (disc.owner as { display_name: string }[] | null)?.[0]?.display_name || 'Anonymous',
        photo_url: photoUrl,
      },
      has_active_recovery: !!activeRecovery,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
