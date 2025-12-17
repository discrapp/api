import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  // Create service role client for storage operations
  // This bypasses storage RLS since we verify ownership via discs table RLS
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Fetch user's discs with photos, QR code, and recovery events
  const { data: discs, error: discsError } = await supabase
    .from('discs')
    .select(
      `
      *,
      photos:disc_photos(id, storage_path, photo_uuid, created_at),
      qr_code:qr_codes(id, short_code, status),
      recovery_events(id, status, finder_id, found_at, surrendered_at, original_owner_id)
    `
    )
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (discsError) {
    console.error('Database error:', discsError);
    return new Response(JSON.stringify({ error: 'Failed to fetch discs', details: discsError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate signed URLs for all photos and process recovery status
  const discsWithPhotoUrls = await Promise.all(
    (discs || []).map(async (disc) => {
      const photosWithUrls = await Promise.all(
        (disc.photos || []).map(
          async (photo: { id: string; storage_path: string; photo_uuid: string; created_at: string }) => {
            const { data: urlData } = await supabaseAdmin.storage
              .from('disc-photos')
              .createSignedUrl(photo.storage_path, 3600); // 1 hour expiry

            return {
              ...photo,
              photo_url: urlData?.signedUrl,
            };
          }
        )
      );

      // Find the most recent active recovery (not recovered, cancelled, or surrendered)
      const recoveryEvents = disc.recovery_events || [];
      const activeRecoveries = recoveryEvents.filter(
        (r: { status: string }) => !['recovered', 'cancelled', 'surrendered'].includes(r.status)
      );
      // Sort by found_at descending and get the first one
      const activeRecovery =
        activeRecoveries.sort(
          (a: { found_at: string }, b: { found_at: string }) =>
            new Date(b.found_at).getTime() - new Date(a.found_at).getTime()
        )[0] || null;

      // Check if this disc was surrendered to the current user (they were the finder)
      const surrenderedRecovery = recoveryEvents.find(
        (r: { status: string; finder_id: string }) => r.status === 'surrendered' && r.finder_id === user.id
      );
      const wasSurrendered = !!surrenderedRecovery;

      // Remove recovery_events from response and add processed fields

      const { recovery_events: _, ...discWithoutRecoveries } = disc;

      return {
        ...discWithoutRecoveries,
        photos: photosWithUrls,
        active_recovery: activeRecovery,
        was_surrendered: wasSurrendered,
        surrendered_at: surrenderedRecovery?.surrendered_at || null,
      };
    })
  );

  return new Response(JSON.stringify(discsWithPhotoUrls), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
