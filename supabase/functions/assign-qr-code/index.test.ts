import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/assign-qr-code';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('assign-qr-code: should return 405 for non-POST requests', async () => {
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

Deno.test('assign-qr-code: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ qr_code: 'ABC123' }),
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('assign-qr-code: should return 400 when qr_code is missing', async () => {
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
    assertEquals(data.error, 'Missing qr_code in request body');
  } finally {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test("assign-qr-code: should return 400 when QR code doesn't exist", async () => {
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
      body: JSON.stringify({ qr_code: 'NONEXISTENT123' }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'QR code not found');
  } finally {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('assign-qr-code: should return 400 when QR code is already assigned', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sign up a test user
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Sign up another user who "owns" the QR code
  const { data: otherAuth, error: otherError } = await supabase.auth.signUp({
    email: `other-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (otherError || !otherAuth.user) {
    throw otherError || new Error('No user');
  }

  // Create an already-assigned QR code
  const testCode = `ASSIGNED${Date.now()}`;
  const { data: qrCode, error: createError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: otherAuth.user.id })
    .select()
    .single();

  if (createError) {
    throw createError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'QR code is already assigned');
  } finally {
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    await supabaseAdmin.auth.admin.deleteUser(otherAuth.user.id);
  }
});

Deno.test('assign-qr-code: should return 400 when QR code is already active', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Sign up another user who "owns" the QR code
  const { data: otherAuth, error: otherError } = await supabase.auth.signUp({
    email: `other-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (otherError || !otherAuth.user) {
    throw otherError || new Error('No user');
  }

  // Create an active QR code
  const testCode = `ACTIVE${Date.now()}`;
  const { data: qrCode, error: createError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'active', assigned_to: otherAuth.user.id })
    .select()
    .single();

  if (createError) {
    throw createError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'QR code is already in use');
  } finally {
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    await supabaseAdmin.auth.admin.deleteUser(otherAuth.user.id);
  }
});

Deno.test('assign-qr-code: should return 400 when QR code is deactivated', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create a deactivated QR code
  const testCode = `DEACTIVATED${Date.now()}`;
  const { data: qrCode, error: createError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'deactivated' })
    .select()
    .single();

  if (createError) {
    throw createError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'QR code has been deactivated');
  } finally {
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('assign-qr-code: should successfully assign QR code to user', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create an unassigned (generated) QR code
  const testCode = `GENERATED${Date.now()}`;
  const { data: qrCode, error: createError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'generated' })
    .select()
    .single();

  if (createError) {
    throw createError;
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertExists(data.qr_code);
    assertEquals(data.qr_code.id, qrCode.id);
    assertEquals(data.qr_code.short_code, testCode);
    assertEquals(data.qr_code.status, 'assigned');
    assertEquals(data.qr_code.assigned_to, authData.user.id);

    // Verify in database
    const { data: updatedQr } = await supabaseAdmin
      .from('qr_codes')
      .select('*')
      .eq('id', qrCode.id)
      .single();

    assertEquals(updatedQr?.status, 'assigned');
    assertEquals(updatedQr?.assigned_to, authData.user.id);
  } finally {
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('assign-qr-code: should be case insensitive for QR code lookup', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create a QR code with uppercase
  const testCode = `CASETEST${Date.now()}`;
  const { data: qrCode, error: createError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'generated' })
    .select()
    .single();

  if (createError) {
    throw createError;
  }

  try {
    // Send lowercase QR code
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode.toLowerCase() }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.qr_code.status, 'assigned');
  } finally {
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
