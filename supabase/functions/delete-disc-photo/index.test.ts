import { assertEquals } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/delete-disc-photo';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('delete-disc-photo: should return 405 for non-DELETE requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('delete-disc-photo: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id: 'test' }),
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('delete-disc-photo: should return 400 when photo_id is missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session) {
    throw signUpError || new Error('No session');
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({}),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'photo_id is required');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('delete-disc-photo: should return 404 when photo not found', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session) {
    throw signUpError || new Error('No session');
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ photo_id: '00000000-0000-0000-0000-000000000000' }),
    });

    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Photo not found');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('delete-disc-photo: should return 403 when user does not own disc', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create disc owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create other user
  const { data: otherAuth, error: otherError } = await supabase.auth.signUp({
    email: `other-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (otherError || !otherAuth.session || !otherAuth.user) {
    throw otherError || new Error('No session');
  }

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create photo record (without actual storage file)
  const { data: photo, error: photoError } = await supabaseAdmin
    .from('disc_photos')
    .insert({
      disc_id: disc.id,
      storage_path: `test/${disc.id}/test-photo.jpg`,
    })
    .select()
    .single();
  if (photoError) throw photoError;

  try {
    // Other user tries to delete owner's photo
    const response = await fetch(FUNCTION_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherAuth.session.access_token}`,
      },
      body: JSON.stringify({ photo_id: photo.id }),
    });

    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You do not own this disc');
  } finally {
    await supabaseAdmin.from('disc_photos').delete().eq('id', photo.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(otherAuth.user.id);
  }
});

Deno.test('delete-disc-photo: owner can delete their own photo', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.session || !ownerAuth.user) {
    throw ownerError || new Error('No session');
  }

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create photo record (without actual storage file for simplicity)
  const { data: photo, error: photoError } = await supabaseAdmin
    .from('disc_photos')
    .insert({
      disc_id: disc.id,
      storage_path: `test/${disc.id}/test-photo.jpg`,
    })
    .select()
    .single();
  if (photoError) throw photoError;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAuth.session.access_token}`,
      },
      body: JSON.stringify({ photo_id: photo.id }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);

    // Verify photo record was deleted
    const { data: deletedPhoto } = await supabaseAdmin.from('disc_photos').select('id').eq('id', photo.id).single();
    assertEquals(deletedPhoto, null);
  } finally {
    // Cleanup (photo should already be deleted)
    await supabaseAdmin.from('disc_photos').delete().eq('id', photo.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
  }
});
