import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/upload-disc-photo';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

Deno.test('upload-disc-photo: should return 401 when not authenticated', async () => {
  const formData = new FormData();
  formData.append('disc_id', 'test-disc-id');
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    body: formData,
  });

  assertEquals(response.status, 401);
});

Deno.test('upload-disc-photo: should return 400 when disc_id is missing', async () => {
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

Deno.test('upload-disc-photo: should return 400 when file is missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const formData = new FormData();
  formData.append('disc_id', 'test-disc-id');

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

Deno.test("upload-disc-photo: should return 403 when user doesn't own disc", async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create first user and disc
  const { data: user1Auth } = await supabase.auth.signUp({
    email: `test1-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabase1 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${user1Auth.session?.access_token}` } },
  });

  const { data: disc } = await supabase1
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create second user and try to upload to first user's disc
  const { data: user2Auth } = await supabase.auth.signUp({
    email: `test2-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const formData = new FormData();
  formData.append('disc_id', disc.id);
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${user2Auth.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 403);
});

Deno.test('upload-disc-photo: should upload photo successfully with UUID filename', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create user and disc
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } },
  });

  const { data: disc } = await supabaseAuth
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Upload photo (no photo_type needed - UUID generated server-side)
  const formData = new FormData();
  formData.append('disc_id', disc.id);
  formData.append('file', new Blob(['test image data'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertExists(data.photo_url);
  assertExists(data.storage_path);
  assertExists(data.photo_id);
  // Verify photo_id is a valid UUID format
  assertEquals(data.photo_id.length, 36);
});

Deno.test('upload-disc-photo: should reject non-image files', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } },
  });

  const { data: disc } = await supabaseAuth
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  const formData = new FormData();
  formData.append('disc_id', disc.id);
  formData.append('file', new Blob(['test'], { type: 'application/pdf' }), 'test.pdf');

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

Deno.test('upload-disc-photo: should enforce maximum 4 photos per disc', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create user and disc
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } },
  });

  const { data: disc } = await supabaseAuth
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Upload 4 photos successfully
  for (let i = 0; i < 4; i++) {
    const formData = new FormData();
    formData.append('disc_id', disc.id);
    formData.append('file', new Blob([`test image ${i}`], { type: 'image/jpeg' }), 'test.jpg');

    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authData.session?.access_token}`,
      },
      body: formData,
    });

    assertEquals(response.status, 200);
  }

  // 5th photo should fail
  const formData = new FormData();
  formData.append('disc_id', disc.id);
  formData.append('file', new Blob(['test image 5'], { type: 'image/jpeg' }), 'test.jpg');

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
    body: formData,
  });

  assertEquals(response.status, 400);
  const error = await response.json();
  assertEquals(error.error, 'Maximum of 4 photos per disc');
});
