import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/unlink-qr-code';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('unlink-qr-code: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('unlink-qr-code: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ disc_id: '123' }),
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('unlink-qr-code: should return 400 when disc_id is missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session) {
    throw signUpError || new Error('No session');
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({}),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing disc_id in request body');
  } finally {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test("unlink-qr-code: should return 400 when disc doesn't exist", async () => {
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
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ disc_id: '00000000-0000-0000-0000-000000000000' }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Disc not found');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('unlink-qr-code: should return 403 when disc not owned by current user', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sign up test user
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Sign up other user who owns the disc
  const { data: otherAuth, error: otherError } = await supabase.auth.signUp({
    email: `other-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (otherError || !otherAuth.user) {
    throw otherError || new Error('No user');
  }

  // Create QR code
  const testCode = `UNLINK${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'active', assigned_to: otherAuth.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc owned by other user
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: otherAuth.user.id,
      qr_code_id: qrCode.id,
      name: 'Not My Disc',
      mold: 'Destroyer',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ disc_id: disc.id }),
    });

    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You do not own this disc');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    await supabaseAdmin.auth.admin.deleteUser(otherAuth.user.id);
  }
});

Deno.test('unlink-qr-code: should return 400 when disc has no QR code linked', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create disc without QR code
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      name: 'No QR Disc',
      mold: 'Destroyer',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ disc_id: disc.id }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Disc has no QR code linked');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('unlink-qr-code: should successfully unlink and delete QR code from disc', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create QR code
  const testCode = `DELETEME${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'active', assigned_to: authData.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc with QR code
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      qr_code_id: qrCode.id,
      name: 'Unlink Me Disc',
      mold: 'Destroyer',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ disc_id: disc.id }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertExists(data.disc);
    assertEquals(data.disc.id, disc.id);
    assertEquals(data.disc.qr_code_id, null);

    // Verify disc updated in database
    const { data: updatedDisc } = await supabaseAdmin.from('discs').select('*').eq('id', disc.id).single();

    assertEquals(updatedDisc?.qr_code_id, null);

    // Verify QR code deleted from database
    const { data: deletedQr } = await supabaseAdmin.from('qr_codes').select('*').eq('id', qrCode.id).maybeSingle();

    assertEquals(deletedQr, null);
  } finally {
    // Cleanup disc (QR code should already be deleted)
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    // Just in case test failed before QR deletion
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
