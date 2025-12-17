import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Upload Drop-off Photo Function
 *
 * Authenticated endpoint for finders to upload a photo of the drop-off location.
 * This photo shows where the disc was left for the owner to retrieve.
 *
 * POST /upload-drop-off-photo
 * Body (multipart/form-data): {
 *   recovery_event_id: string,
 *   file: File
 * }
 *
 * Validations:
 * - User must be authenticated
 * - User must be the finder of the recovery event
 * - Recovery event must be in 'found' status
 * - File must be an image (jpeg, png, webp)
 * - File must be under 5MB
 */

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
  const recoveryEventId = formData.get('recovery_event_id') as string;
  const file = formData.get('file') as File;

  // Validate required fields
  if (!recoveryEventId) {
    return new Response(JSON.stringify({ error: 'recovery_event_id is required' }), {
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

  // Create service role client for privileged operations
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Get the recovery event
  const { data: recoveryEvent, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .select('id, finder_id, status')
    .eq('id', recoveryEventId)
    .single();

  if (recoveryError || !recoveryEvent) {
    return new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify user is the finder
  if (recoveryEvent.finder_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the finder can upload drop-off photos' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify recovery is in 'found' status
  if (recoveryEvent.status !== 'found') {
    return new Response(JSON.stringify({ error: 'Can only upload drop-off photo for a recovery in found status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate unique photo ID
  const photoId = crypto.randomUUID();

  // Determine file extension
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';

  // Upload file to storage
  // Path: drop-offs/{recovery_event_id}/{uuid}.{extension}
  const storagePath = `drop-offs/${recoveryEventId}/${photoId}.${extension}`;

  const { error: uploadError } = await supabaseAdmin.storage.from('disc-photos').upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    return new Response(JSON.stringify({ error: 'Failed to upload photo', details: uploadError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get public URL for the photo
  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from('disc-photos').getPublicUrl(storagePath);

  return new Response(
    JSON.stringify({
      success: true,
      photo_url: publicUrl,
      storage_path: storagePath,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
