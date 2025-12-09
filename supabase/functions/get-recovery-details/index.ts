import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getGravatarUrl } from '../_shared/gravatar.ts';

/**
 * Get Recovery Details Function
 *
 * Returns full details about a recovery event for both owners and finders.
 *
 * GET /get-recovery-details?id=<recovery_event_id>
 *
 * Returns:
 * - Recovery event info (status, messages, timestamps)
 * - Disc info (name, manufacturer, mold, plastic, color, photo)
 * - Owner and finder display names
 * - Meetup proposals (if any)
 * - User's role (owner or finder)
 */

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get recovery event ID from query params
  const url = new URL(req.url);
  const recoveryId = url.searchParams.get('id');

  if (!recoveryId) {
    return new Response(JSON.stringify({ error: 'Missing recovery event ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get recovery event with disc info
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .select(
      `
      id,
      disc_id,
      finder_id,
      status,
      finder_message,
      found_at,
      recovered_at,
      created_at,
      updated_at,
      disc:discs(
        id,
        name,
        manufacturer,
        mold,
        plastic,
        color,
        reward_amount,
        owner_id
      )
    `
    )
    .eq('id', recoveryId)
    .single();

  if (recoveryError || !recovery) {
    return new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cast disc to proper type
  const disc = recovery.disc as unknown as {
    id: string;
    name: string;
    manufacturer: string;
    mold: string;
    plastic: string;
    color: string;
    reward_amount: number;
    owner_id: string;
  } | null;

  // Check if user is owner or finder
  const isOwner = disc?.owner_id === user.id;
  const isFinder = recovery.finder_id === user.id;

  if (!isOwner && !isFinder) {
    return new Response(JSON.stringify({ error: 'You do not have access to this recovery event' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get owner profile
  let ownerDisplayName = 'Unknown';
  let ownerAvatarUrl: string | null = null;
  if (disc?.owner_id) {
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('username, full_name, display_preference, email')
      .eq('id', disc.owner_id)
      .single();

    if (ownerProfile) {
      if (ownerProfile.display_preference === 'full_name' && ownerProfile.full_name) {
        ownerDisplayName = ownerProfile.full_name;
      } else if (ownerProfile.username) {
        ownerDisplayName = ownerProfile.username;
      } else if (ownerProfile.email) {
        ownerDisplayName = ownerProfile.email.split('@')[0];
      }
      ownerAvatarUrl = await getGravatarUrl(ownerProfile.email);
    }
  }

  // Get finder profile
  let finderDisplayName = 'Unknown';
  let finderAvatarUrl: string | null = null;
  const { data: finderProfile } = await supabaseAdmin
    .from('profiles')
    .select('username, full_name, display_preference, email')
    .eq('id', recovery.finder_id)
    .single();

  if (finderProfile) {
    if (finderProfile.display_preference === 'full_name' && finderProfile.full_name) {
      finderDisplayName = finderProfile.full_name;
    } else if (finderProfile.username) {
      finderDisplayName = finderProfile.username;
    } else if (finderProfile.email) {
      finderDisplayName = finderProfile.email.split('@')[0];
    }
    finderAvatarUrl = await getGravatarUrl(finderProfile.email);
  }

  // Get disc photo
  let photoUrl = null;
  if (disc?.id) {
    const { data: photos } = await supabaseAdmin
      .from('disc_photos')
      .select('storage_path')
      .eq('disc_id', disc.id)
      .limit(1);

    if (photos && photos.length > 0) {
      const { data: urlData } = await supabaseAdmin.storage
        .from('disc-photos')
        .createSignedUrl(photos[0].storage_path, 3600);
      photoUrl = urlData?.signedUrl || null;
    }
  }

  // Get meetup proposals
  const { data: proposals } = await supabaseAdmin
    .from('meetup_proposals')
    .select('*')
    .eq('recovery_event_id', recoveryId)
    .order('created_at', { ascending: false });

  // Get drop-off details (if any)
  const { data: dropOff } = await supabaseAdmin
    .from('drop_offs')
    .select('*')
    .eq('recovery_event_id', recoveryId)
    .single();

  return new Response(
    JSON.stringify({
      id: recovery.id,
      status: recovery.status,
      finder_message: recovery.finder_message,
      found_at: recovery.found_at,
      recovered_at: recovery.recovered_at,
      created_at: recovery.created_at,
      updated_at: recovery.updated_at,
      user_role: isOwner ? 'owner' : 'finder',
      disc: disc
        ? {
            id: disc.id,
            name: disc.name,
            manufacturer: disc.manufacturer,
            mold: disc.mold,
            plastic: disc.plastic,
            color: disc.color,
            reward_amount: disc.reward_amount,
            photo_url: photoUrl,
          }
        : null,
      owner: {
        id: disc?.owner_id,
        display_name: ownerDisplayName,
        avatar_url: ownerAvatarUrl,
      },
      finder: {
        id: recovery.finder_id,
        display_name: finderDisplayName,
        avatar_url: finderAvatarUrl,
      },
      meetup_proposals: proposals || [],
      drop_off: dropOff || null,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
