import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const VALID_PHOTO_TYPES = ['top', 'bottom', 'side'];

Deno.serve(async (req) => {
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

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Extract fields
  const discId = formData.get('disc_id') as string;
  const photoType = formData.get('photo_type') as string;
  const file = formData.get('file') as File;

  // Validate required fields
  if (!discId) {
    return new Response(JSON.stringify({ error: 'disc_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!photoType || !VALID_PHOTO_TYPES.includes(photoType)) {
    return new Response(JSON.stringify({ error: 'photo_type must be one of: top, bottom, side' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!file) {
    return new Response(JSON.stringify({ error: 'file is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate file type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return new Response(JSON.stringify({ error: 'File must be an image (jpeg, png, or webp)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: 'File size must be less than 5MB' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify user owns the disc
  const { data: disc, error: discError } = await supabase
    .from('discs')
    .select('id, owner_id')
    .eq('id', discId)
    .single();

  if (discError || !disc) {
    return new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (disc.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Determine file extension
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';

  // Upload file to storage
  // Path: {user_id}/{disc_id}/{photo_type}.{extension}
  const storagePath = `${user.id}/${discId}/${photoType}.${extension}`;

  const { error: uploadError } = await supabase.storage.from('disc-photos').upload(storagePath, file, {
    contentType: file.type,
    upsert: true, // Replace if exists
  });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    return new Response(JSON.stringify({ error: 'Failed to upload photo', details: uploadError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create disc_photos record
  const { data: photoRecord, error: dbError } = await supabase
    .from('disc_photos')
    .insert({
      disc_id: discId,
      storage_path: storagePath,
      photo_type: photoType,
    })
    .select()
    .single();

  if (dbError) {
    console.error('Database error:', dbError);
    // Photo is uploaded but DB record failed - not ideal but photo exists
    return new Response(JSON.stringify({ error: 'Failed to save photo record', details: dbError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get signed URL for the photo
  const { data: urlData } = await supabase.storage.from('disc-photos').createSignedUrl(storagePath, 3600); // 1 hour expiry

  return new Response(
    JSON.stringify({
      id: photoRecord.id,
      disc_id: discId,
      photo_type: photoType,
      storage_path: storagePath,
      photo_url: urlData?.signedUrl,
      created_at: photoRecord.created_at,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
