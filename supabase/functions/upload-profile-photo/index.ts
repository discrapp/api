import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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

  // Extract file
  const file = formData.get('file') as File;

  // Validate file exists
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

  // Create service role client for storage operations
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Determine file extension
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';

  // Storage path: {user_id}.{extension}
  const storagePath = `${user.id}.${extension}`;

  // Delete any existing photos for this user (different extensions)
  const extensions = ['jpg', 'png', 'webp'];
  const filesToRemove = extensions.filter((ext) => ext !== extension).map((ext) => `${user.id}.${ext}`);
  if (filesToRemove.length > 0) {
    await supabaseAdmin.storage.from('profile-photos').remove(filesToRemove);
  }

  // Upload file to storage (upsert to replace if exists)
  const { error: uploadError } = await supabaseAdmin.storage.from('profile-photos').upload(storagePath, file, {
    contentType: file.type,
    upsert: true,
  });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    return new Response(JSON.stringify({ error: 'Failed to upload photo', details: uploadError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update profile with avatar_url
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ avatar_url: storagePath })
    .eq('id', user.id);

  if (updateError) {
    console.error('Profile update error:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to update profile', details: updateError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get signed URL for the uploaded photo
  const { data: urlData } = await supabaseAdmin.storage.from('profile-photos').createSignedUrl(storagePath, 3600);

  return new Response(
    JSON.stringify({
      success: true,
      storage_path: storagePath,
      avatar_url: urlData?.signedUrl,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
