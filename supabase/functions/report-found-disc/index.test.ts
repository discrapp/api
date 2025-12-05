import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/report-found-disc';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('report-found-disc: should return 405 for non-POST requests', async () => {
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

Deno.test('report-found-disc: should return 401 when not authenticated', async () => {
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

Deno.test('report-found-disc: should return 400 when qr_code is missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign up a test user
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

Deno.test('report-found-disc: should return 400 for invalid QR code', async () => {
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
    assertEquals(data.error, 'Invalid QR code');
  } finally {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('report-found-disc: should return 400 for unassigned QR code', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create an unassigned QR code
  const testCode = `UNASSIGNED${Date.now()}`;
  const { data: qrCode, error: createError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'available' })
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
    assertEquals(data.error, 'QR code is not assigned to a disc');
  } finally {
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('report-found-disc: should return 400 when finder reports their own disc', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sign up owner (who will try to report their own disc)
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create QR code assigned to this user
  const testCode = `OWNDISC${Date.now()}`;
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .insert({ short_code: testCode, status: 'assigned', assigned_to: authData.user.id })
    .select()
    .single();

  if (qrError) {
    throw qrError;
  }

  // Create disc owned by this user
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: authData.user.id,
      qr_code_id: qrCode.id,
      name: 'My Own Disc',
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
      body: JSON.stringify({ qr_code: testCode }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'You cannot report your own disc as found');
  } finally {
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('report-found-disc: should return 400 when disc has active recovery', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sign up owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (ownerError || !ownerAuth.user) {
    throw ownerError || new Error('No user');
  }

  // Sign up first finder
  const { data: finder1Auth, error: finder1Error } = await supabase.auth.signUp({
    email: `finder1-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (finder1Error || !finder1Auth.user) {
    throw finder1Error || new Error('No user');
  }

  // Sign up second finder (will try to report)
  const { data: finder2Auth, error: finder2Error } = await supabase.auth.signUp({
    email: `finder2-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (finder2Error || !finder2Auth.session || !finder2Auth.user) {
    throw finder2Error || new Error('No session');
  }

  // Create QR code
  const testCode = `ACTIVERECOV${Date.now()}`;
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

  // Create existing active recovery (from first finder)
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finder1Auth.user.id,
      status: 'found',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (recoveryError) {
    throw recoveryError;
  }

  try {
    // Second finder tries to report same disc
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finder2Auth.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'This disc already has an active recovery in progress');
    assertEquals(data.recovery_status, 'found');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finder1Auth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finder2Auth.user.id);
  }
});

Deno.test('report-found-disc: should successfully create recovery event', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sign up owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (ownerError || !ownerAuth.user) {
    throw ownerError || new Error('No user');
  }

  // Sign up finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (finderError || !finderAuth.session || !finderAuth.user) {
    throw finderError || new Error('No session');
  }

  // Create QR code
  const testCode = `FOUNDDISC${Date.now()}`;
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
      name: 'Found Disc',
      mold: 'Teebird',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  let recoveryEventId: string | null = null;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode, message: 'Found it near hole 5!' }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertExists(data.recovery_event);
    assertExists(data.recovery_event.id);
    assertEquals(data.recovery_event.disc_id, disc.id);
    assertEquals(data.recovery_event.disc_name, 'Found Disc');
    assertEquals(data.recovery_event.status, 'found');
    assertEquals(data.recovery_event.finder_message, 'Found it near hole 5!');
    assertExists(data.recovery_event.found_at);

    recoveryEventId = data.recovery_event.id;
  } finally {
    if (recoveryEventId) {
      await supabaseAdmin.from('recovery_events').delete().eq('id', recoveryEventId);
    }
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('report-found-disc: should be case insensitive for QR code lookup', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sign up owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (ownerError || !ownerAuth.user) {
    throw ownerError || new Error('No user');
  }

  // Sign up finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (finderError || !finderAuth.session || !finderAuth.user) {
    throw finderError || new Error('No session');
  }

  // Create QR code with uppercase
  const testCode = `CASETEST${Date.now()}`;
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
      name: 'Case Test Disc',
      mold: 'Mako3',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  let recoveryEventId: string | null = null;

  try {
    // Send lowercase QR code
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode.toLowerCase() }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    recoveryEventId = data.recovery_event.id;
  } finally {
    if (recoveryEventId) {
      await supabaseAdmin.from('recovery_events').delete().eq('id', recoveryEventId);
    }
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('report-found-disc: should work without optional message', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Sign up owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (ownerError || !ownerAuth.user) {
    throw ownerError || new Error('No user');
  }

  // Sign up finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (finderError || !finderAuth.session || !finderAuth.user) {
    throw finderError || new Error('No session');
  }

  // Create QR code
  const testCode = `NOMSG${Date.now()}`;
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
      name: 'No Message Disc',
      mold: 'Buzzz',
    })
    .select()
    .single();

  if (discError) {
    throw discError;
  }

  let recoveryEventId: string | null = null;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({ qr_code: testCode }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.recovery_event.finder_message, null);
    recoveryEventId = data.recovery_event.id;
  } finally {
    if (recoveryEventId) {
      await supabaseAdmin.from('recovery_events').delete().eq('id', recoveryEventId);
    }
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.from('qr_codes').delete().eq('id', qrCode.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});
