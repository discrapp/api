import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/upload-drop-off-photo';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

Deno.test('upload-drop-off-photo: should return 401 when not authenticated', async () => {
  const formData = new FormData();
  formData.append('recovery_event_id', 'test-recovery-id');
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    body: formData,
  });

  assertEquals(response.status, 401);
});

Deno.test('upload-drop-off-photo: should return 400 when recovery_event_id is missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const formData = new FormData();
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 400);
  const error = await response.json();
  assertExists(error.error);
});

Deno.test('upload-drop-off-photo: should return 400 when file is missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const formData = new FormData();
  formData.append('recovery_event_id', 'test-recovery-id');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 400);
  const error = await response.json();
  assertExists(error.error);
});

Deno.test('upload-drop-off-photo: should return 404 when recovery event does not exist', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const formData = new FormData();
  formData.append('recovery_event_id', '00000000-0000-0000-0000-000000000000');
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 404);
  const error = await response.json();
  assertEquals(error.error, 'Recovery event not found');
});

Deno.test('upload-drop-off-photo: should return 403 when user is not the finder', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create owner user and disc
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseOwner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  const { data: disc } = await supabaseOwner
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder user
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseFinder = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${finderAuth.session?.access_token}` } },
  });

  // Create recovery event (finder reports found disc)
  const { data: recovery } = await supabaseFinder
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user?.id,
      status: 'found',
    })
    .select()
    .single();

  // Create third user who is not the finder
  const { data: otherAuth } = await supabase.auth.signUp({
    email: `other-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const formData = new FormData();
  formData.append('recovery_event_id', recovery.id);
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${otherAuth.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 403);
  const error = await response.json();
  assertEquals(error.error, 'Only the finder can upload drop-off photos');
});

Deno.test('upload-drop-off-photo: should return 400 when recovery is not in found status', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create owner user and disc
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseOwner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  const { data: disc } = await supabaseOwner
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder user
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseFinder = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${finderAuth.session?.access_token}` } },
  });

  // Create recovery event with 'completed' status
  const { data: recovery } = await supabaseFinder
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user?.id,
      status: 'completed',
    })
    .select()
    .single();

  const formData = new FormData();
  formData.append('recovery_event_id', recovery.id);
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${finderAuth.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 400);
  const error = await response.json();
  assertEquals(error.error, 'Can only upload drop-off photo for a recovery in found status');
});

Deno.test('upload-drop-off-photo: should upload photo successfully', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create owner user and disc
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseOwner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  const { data: disc } = await supabaseOwner
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder user
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseFinder = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${finderAuth.session?.access_token}` } },
  });

  // Create recovery event in 'found' status
  const { data: recovery } = await supabaseFinder
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user?.id,
      status: 'found',
    })
    .select()
    .single();

  const formData = new FormData();
  formData.append('recovery_event_id', recovery.id);
  formData.append('file', new Blob(['test image data'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${finderAuth.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.photo_url);
  assertExists(data.storage_path);
  // Verify storage path format: drop-offs/{recovery_event_id}/{uuid}.jpg
  assertEquals(data.storage_path.startsWith(`drop-offs/${recovery.id}/`), true);
  assertEquals(data.storage_path.endsWith('.jpg'), true);
});

Deno.test('upload-drop-off-photo: should reject non-image files', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create owner user and disc
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseOwner = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  const { data: disc } = await supabaseOwner
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder user
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseFinder = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${finderAuth.session?.access_token}` } },
  });

  // Create recovery event in 'found' status
  const { data: recovery } = await supabaseFinder
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user?.id,
      status: 'found',
    })
    .select()
    .single();

  const formData = new FormData();
  formData.append('recovery_event_id', recovery.id);
  formData.append('file', new Blob(['test'], { type: 'application/pdf' }), 'test.pdf');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${finderAuth.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 400);
  const error = await response.json();
  assertEquals(error.error, 'File must be an image (jpeg, png, or webp)');
});
