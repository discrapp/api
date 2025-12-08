import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface DeletePhotoRequest {
  photo_id: string;
}

Deno.serve(async (req) => {
  // Only allow DELETE requests
  if (req.method !== 'DELETE') {
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

  // Parse request body
  let body: DeletePhotoRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.photo_id || body.photo_id.trim() === '') {
    return new Response(JSON.stringify({ error: 'photo_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create service role client for privileged operations
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Get the photo record with disc info to verify ownership
  const { data: photo, error: photoError } = await supabaseAdmin
    .from('disc_photos')
    .select('id, storage_path, disc_id, disc:discs(owner_id)')
    .eq('id', body.photo_id)
    .single();

  if (photoError || !photo) {
    return new Response(JSON.stringify({ error: 'Photo not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify user owns the disc
  const discData = Array.isArray(photo.disc) ? photo.disc[0] : photo.disc;
  if (!discData || discData.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete from storage
  const { error: storageError } = await supabaseAdmin.storage.from('disc-photos').remove([photo.storage_path]);

  if (storageError) {
    console.error('Storage delete error:', storageError);
    // Continue to delete DB record even if storage fails (file may not exist)
  }

  // Delete from database
  const { error: dbError } = await supabaseAdmin.from('disc_photos').delete().eq('id', body.photo_id);

  if (dbError) {
    console.error('Database delete error:', dbError);
    return new Response(JSON.stringify({ error: 'Failed to delete photo record', details: dbError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, message: 'Photo deleted successfully' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
