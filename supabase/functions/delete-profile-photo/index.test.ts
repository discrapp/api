import { assertEquals } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/delete-profile-photo';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('delete-profile-photo: should return 405 for non-DELETE requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('delete-profile-photo: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('delete-profile-photo: returns success when no photo exists (idempotent)', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  try {
    // Verify user has no avatar_url
    const { data: profileBefore } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', authData.user.id)
      .single();
    assertEquals(profileBefore?.avatar_url, null);

    const response = await fetch(FUNCTION_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('delete-profile-photo: successfully deletes existing photo', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  try {
    // Upload a test photo first
    const storagePath = `${authData.user.id}.jpg`;
    const testContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // Minimal JPEG header

    await supabaseAdmin.storage.from('profile-photos').upload(storagePath, testContent, {
      contentType: 'image/jpeg',
      upsert: true,
    });

    // Set avatar_url in profile
    await supabaseAdmin.from('profiles').update({ avatar_url: storagePath }).eq('id', authData.user.id);

    // Verify setup
    const { data: profileBefore } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', authData.user.id)
      .single();
    assertEquals(profileBefore?.avatar_url, storagePath);

    // Delete the photo
    const response = await fetch(FUNCTION_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);

    // Verify avatar_url is cleared
    const { data: profileAfter } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', authData.user.id)
      .single();
    assertEquals(profileAfter?.avatar_url, null);

    // Verify file is deleted from storage
    const { data: files } = await supabaseAdmin.storage.from('profile-photos').list();
    const userFiles = files?.filter((f) => f.name === storagePath) || [];
    assertEquals(userFiles.length, 0);
  } finally {
    // Cleanup (in case test failed)
    await supabaseAdmin.storage.from('profile-photos').remove([`${authData.user.id}.jpg`]);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('delete-profile-photo: deletes all extensions for user', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  try {
    // Upload photos with different extensions (simulating edge case)
    const testContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    for (const ext of ['jpg', 'png', 'webp']) {
      await supabaseAdmin.storage.from('profile-photos').upload(`${authData.user.id}.${ext}`, testContent, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: true,
      });
    }

    // Set avatar_url
    await supabaseAdmin.from('profiles').update({ avatar_url: `${authData.user.id}.jpg` }).eq('id', authData.user.id);

    // Delete
    const response = await fetch(FUNCTION_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);

    // Verify all files are deleted
    const { data: files } = await supabaseAdmin.storage.from('profile-photos').list();
    const userFiles = files?.filter((f) => f.name.startsWith(authData.user!.id)) || [];
    assertEquals(userFiles.length, 0);
  } finally {
    // Cleanup
    for (const ext of ['jpg', 'png', 'webp']) {
      await supabaseAdmin.storage.from('profile-photos').remove([`${authData.user.id}.${ext}`]);
    }
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
