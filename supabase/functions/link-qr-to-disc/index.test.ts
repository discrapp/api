import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/link-qr-to-disc';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('link-qr-to-disc: should return 405 for non-POST requests', async () => {
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

Deno.test('link-qr-to-disc: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ qr_code: 'ABC123', disc_id: '123' }),
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('link-qr-to-disc: should return 400 when qr_code is missing', async () => {
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
      body: JSON.stringify({ disc_id: '123' }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing qr_code in request body');
  } finally {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('link-qr-to-disc: should return 400 when disc_id is missing', async () => {
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
      body: JSON.stringify({ qr_code: 'ABC123' }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing disc_id in request body');
  } finally {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test("link-qr-to-disc: should return 400 when QR code doesn't exist", async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create a disc for this user
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      name: 'Test Disc',
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
      body: JSON.stringify({ qr_code: 'NONEXISTENT123', disc_id: disc.id }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'QR code not found');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('link-qr-to-disc: should return 403 when QR code not assigned to current user', async () => {
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

  // Sign up another user who owns the QR code
  const { data: otherAuth, error: otherError } = await supabase.auth.signUp({
    email: `other-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (otherError || !otherAuth.user) {
    throw otherError || new Error('No user');
  }

  // Create QR code assigned to other user
  const testCode = `OTHERUSER${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: otherAuth.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc owned by test user
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      name: 'My Disc',
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
      body: JSON.stringify({ qr_code: testCode, disc_id: disc.id }),
    });

    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'QR code is not assigned to you');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    await supabaseAdmin.auth.admin.deleteUser(otherAuth.user.id);
  }
});

Deno.test("link-qr-to-disc: should return 400 when QR code is not in 'assigned' status", async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create QR code in 'generated' status (not assigned)
  const testCode = `GENERATED${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'generated' })
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
      name: 'My Disc',
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
      body: JSON.stringify({ qr_code: testCode, disc_id: disc.id }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'QR code must be assigned before linking to a disc');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test("link-qr-to-disc: should return 400 when disc doesn't exist", async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create QR code assigned to user
  const testCode = `NODISC${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: authData.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode, disc_id: '00000000-0000-0000-0000-000000000000' }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Disc not found');
  } finally {
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('link-qr-to-disc: should return 403 when disc not owned by current user', async () => {
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

  // Create QR code assigned to test user
  const testCode = `NOTMYDISC${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: authData.user.id })
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
      body: JSON.stringify({ qr_code: testCode, disc_id: disc.id }),
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

Deno.test('link-qr-to-disc: should return 400 when disc already has a QR code', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create existing QR code linked to disc
  const existingCode = `EXISTING${Date.now()}`;
  const { data: existingQr, error: existingQrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: existingCode, status: 'active', assigned_to: authData.user.id })
    .select()
    .single();

  if (existingQrError) {
    throw existingQrError;
  }

  // Create disc with existing QR code
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      qr_code_id: existingQr.id,
      name: 'Already Linked Disc',
      mold: 'Destroyer',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  // Create new QR code to try to link
  const newCode = `NEWQR${Date.now()}`;
  const { data: newQr, error: newQrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: newCode, status: 'assigned', assigned_to: authData.user.id })
    .select()
    .single();

  if (newQrError) {
    throw newQrError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: newCode, disc_id: disc.id }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Disc already has a QR code linked');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', existingQr.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', newQr.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('link-qr-to-disc: should successfully link QR code to disc', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create QR code assigned to user
  const testCode = `LINKME${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: authData.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc without QR code
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      name: 'Link Me Disc',
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
      body: JSON.stringify({ qr_code: testCode, disc_id: disc.id }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertExists(data.disc);
    assertEquals(data.disc.id, disc.id);
    assertEquals(data.disc.qr_code_id, qrCode.id);
    assertExists(data.qr_code);
    assertEquals(data.qr_code.id, qrCode.id);
    assertEquals(data.qr_code.status, 'active');

    // Verify disc updated in database
    const { data: updatedDisc } = await supabaseAdmin.from('discs').select('*').eq('id', disc.id).single();

    assertEquals(updatedDisc?.qr_code_id, qrCode.id);

    // Verify QR code status updated in database
    const { data: updatedQr } = await supabaseAdmin.from('qr_codes').select('*').eq('id', qrCode.id).single();

    assertEquals(updatedQr?.status, 'active');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('link-qr-to-disc: should be case insensitive for QR code lookup', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create QR code with uppercase
  const testCode = `CASELINK${Date.now()}`;
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
      name: 'Case Test Disc',
      mold: 'Destroyer',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  try {
    // Send lowercase QR code
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode.toLowerCase(), disc_id: disc.id }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
