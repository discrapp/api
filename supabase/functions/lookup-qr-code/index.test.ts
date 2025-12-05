import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/lookup-qr-code';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('lookup-qr-code: should return 405 for non-GET requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: 'ABC123' }),
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('lookup-qr-code: should return 400 when code parameter is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing code parameter');
});

Deno.test('lookup-qr-code: should return found=false for non-existent QR code', async () => {
  const response = await fetch(`${FUNCTION_URL}?code=NONEXISTENT123`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.found, false);
});

Deno.test('lookup-qr-code: should return found=false for unassigned QR code', async () => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create an unassigned QR code
  const testCode = `TEST${Date.now()}`;
  const { data: qrCode, error: createError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'available' })
    .select()
    .single();

  if (createError) {
    console.error('Setup failed:', createError);
    throw createError;
  }

  try {
    const response = await fetch(`${FUNCTION_URL}?code=${testCode}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.found, false);
  } finally {
    // Cleanup
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
  }
});

Deno.test('lookup-qr-code: should return disc info for assigned QR code', async () => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign up a test user
  const testEmail = `test-${Date.now()}@example.com`;
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: 'testpassword123',
  });

  if (signUpError || !authData.user) {
    console.error('Auth setup failed:', signUpError);
    throw signUpError;
  }

  // Create QR code
  const testCode = `TEST${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: authData.user.id })
    .select()
    .single();

  if (qrError) {
    console.error('QR code setup failed:', qrError);
    throw qrError;
  }

  // Create disc linked to QR code
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      qr_code_id: qrCode.id,
      name: 'Test Destroyer',
      mold: 'Destroyer',
      manufacturer: 'Innova',
      plastic: 'Star',
      color: 'Blue',
      reward_amount: 5.0,
    })
    .select()
    .single();

  if (discError) {
    console.error('Disc setup failed:', discError);
    throw discError;
  }

  try {
    const response = await fetch(`${FUNCTION_URL}?code=${testCode}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.found, true);
    assertExists(data.disc);
    assertEquals(data.disc.id, disc.id);
    assertEquals(data.disc.name, 'Test Destroyer');
    assertEquals(data.disc.mold, 'Destroyer');
    assertEquals(data.disc.manufacturer, 'Innova');
    assertEquals(data.disc.color, 'Blue');
    assertEquals(data.disc.reward_amount, 5.0);
    assertExists(data.disc.owner_display_name);
    assertEquals(data.has_active_recovery, false);
  } finally {
    // Cleanup in reverse order
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('lookup-qr-code: should be case insensitive for code lookup', async () => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign up a test user
  const testEmail = `test-${Date.now()}@example.com`;
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: 'testpassword123',
  });

  if (signUpError || !authData.user) {
    throw signUpError;
  }

  // Create QR code with uppercase
  const testCode = `TESTCASE${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: authData.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      qr_code_id: qrCode.id,
      name: 'Test Disc',
      mold: 'Mako3',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  try {
    // Lookup with lowercase
    const response = await fetch(`${FUNCTION_URL}?code=${testCode.toLowerCase()}`, {
      method: 'GET',
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.found, true);
    assertEquals(data.disc.id, disc.id);
  } finally {
    // Cleanup
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('lookup-qr-code: should indicate has_active_recovery when recovery exists', async () => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign up owner
  const ownerEmail = `owner-${Date.now()}@example.com`;
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: ownerEmail,
    password: 'testpassword123',
  });

  if (ownerError || !ownerAuth.user) {
    throw ownerError;
  }

  // Sign up finder
  const finderEmail = `finder-${Date.now()}@example.com`;
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: finderEmail,
    password: 'testpassword123',
  });

  if (finderError || !finderAuth.user) {
    throw finderError;
  }

  // Create QR code
  const testCode = `TESTRECOV${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: ownerAuth.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: ownerAuth.user.id,
      qr_code_id: qrCode.id,
      name: 'Lost Disc',
      mold: 'Wraith',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  // Create active recovery event
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'found',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (recoveryError) {
    throw recoveryError;
  }

  try {
    const response = await fetch(`${FUNCTION_URL}?code=${testCode}`, {
      method: 'GET',
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.found, true);
    assertEquals(data.has_active_recovery, true);
  } finally {
    // Cleanup
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('lookup-qr-code: should not expose owner private info', async () => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign up a test user
  const testEmail = `private-test-${Date.now()}@example.com`;
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: 'testpassword123',
  });

  if (signUpError || !authData.user) {
    throw signUpError;
  }

  // Create QR code
  const testCode = `TESTPRIV${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: authData.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      qr_code_id: qrCode.id,
      name: 'Private Disc',
      mold: 'Teebird',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  try {
    const response = await fetch(`${FUNCTION_URL}?code=${testCode}`, {
      method: 'GET',
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.found, true);

    // Verify no sensitive owner info is exposed
    assertEquals(data.disc.owner_id, undefined);
    assertEquals(data.disc.email, undefined);
    assertEquals(data.disc.phone, undefined);
    assertExists(data.disc.owner_display_name); // Only display name is exposed
  } finally {
    // Cleanup
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
