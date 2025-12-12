import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Get My Finds Function
 *
 * Returns all recovery events where the current user is the finder.
 * Includes disc information and recovery status.
 *
 * GET /get-my-finds
 *
 * Returns:
 * - Array of recovery events with disc info
 */

Deno.serve(async (req) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
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

  // Create Supabase client
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

  // Use service role to fetch recovery events (bypasses RLS)
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get recovery events where user is the finder
  const { data: recoveries, error: recoveriesError } = await supabaseAdmin
    .from('recovery_events')
    .select(
      `
      id,
      status,
      finder_message,
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
    .eq('finder_id', user.id)
    .in('status', ['found', 'meetup_proposed', 'meetup_confirmed', 'dropped_off'])
    .order('created_at', { ascending: false });

  if (recoveriesError) {
    console.error('Database error:', recoveriesError);
    return new Response(JSON.stringify({ error: 'Failed to fetch recoveries', details: recoveriesError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get owner display names and disc photos
  const recoveriesWithDetails = await Promise.all(
    (recoveries || []).map(async (recovery) => {
      // Extract disc (Supabase returns single object for foreign key relations)
      // Cast through unknown since TypeScript incorrectly infers this as an array
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

      // Get owner display name
      let ownerDisplayName = 'Anonymous';
      if (disc?.owner_id) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('username, full_name, display_preference, email')
          .eq('id', disc.owner_id)
          .single();
        if (profile) {
          if (profile.display_preference === 'full_name' && profile.full_name) {
            ownerDisplayName = profile.full_name;
          } else if (profile.username) {
            ownerDisplayName = profile.username;
          } else if (profile.email) {
            ownerDisplayName = profile.email.split('@')[0];
          }
        }
      }

      // Get first disc photo
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

      return {
        id: recovery.id,
        status: recovery.status,
        finder_message: recovery.finder_message,
        created_at: recovery.created_at,
        updated_at: recovery.updated_at,
        disc: disc
          ? {
              id: disc.id,
              name: disc.name,
              manufacturer: disc.manufacturer,
              mold: disc.mold,
              plastic: disc.plastic,
              color: disc.color,
              reward_amount: disc.reward_amount,
              owner_display_name: ownerDisplayName,
              photo_url: photoUrl,
            }
          : null,
      };
    })
  );

  return new Response(JSON.stringify(recoveriesWithDetails), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
