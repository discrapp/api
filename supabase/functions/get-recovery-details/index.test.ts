import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/get-recovery-details';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('get-recovery-details: should return 405 for non-GET requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('get-recovery-details: should return 401 when not authenticated', async () => {
  const response = await fetch(`${FUNCTION_URL}?id=test-id`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('get-recovery-details: should return 400 when id is missing', async () => {
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
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing recovery event ID');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('get-recovery-details: should return 404 when recovery not found', async () => {
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
    const response = await fetch(`${FUNCTION_URL}?id=00000000-0000-0000-0000-000000000000`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });

    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Recovery event not found');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('get-recovery-details: should return 403 when user is not owner or finder', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create uninvolved user
  const { data: uninvolvedAuth, error: uninvolvedError } = await supabase.auth.signUp({
    email: `uninvolved-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (uninvolvedError || !uninvolvedAuth.session || !uninvolvedAuth.user) {
    throw uninvolvedError || new Error('No session');
  }

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event
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
  if (recoveryError) throw recoveryError;

  try {
    const response = await fetch(`${FUNCTION_URL}?id=${recovery.id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${uninvolvedAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You do not have access to this recovery event');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(uninvolvedAuth.user.id);
  }
});

Deno.test('get-recovery-details: owner can access recovery details', async () => {
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

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({
      owner_id: ownerAuth.user.id,
      name: 'Test Disc',
      mold: 'Destroyer',
      manufacturer: 'Innova',
      plastic: 'Star',
      color: 'Blue',
      reward_amount: 10,
    })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'found',
      finder_message: 'Found it!',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  try {
    const response = await fetch(`${FUNCTION_URL}?id=${recovery.id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.id, recovery.id);
    assertEquals(data.status, 'found');
    assertEquals(data.user_role, 'owner');
    assertEquals(data.finder_message, 'Found it!');
    assertExists(data.disc);
    assertEquals(data.disc.name, 'Test Disc');
    assertEquals(data.disc.manufacturer, 'Innova');
    assertExists(data.owner);
    assertExists(data.finder);
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('get-recovery-details: finder can access recovery details', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.session || !finderAuth.user) {
    throw finderError || new Error('No session');
  }

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event
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
  if (recoveryError) throw recoveryError;

  try {
    const response = await fetch(`${FUNCTION_URL}?id=${recovery.id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.id, recovery.id);
    assertEquals(data.user_role, 'finder');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('get-recovery-details: includes meetup proposals', async () => {
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

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'meetup_proposed',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  // Create meetup proposal
  const { data: proposal, error: proposalError } = await supabaseAdmin
    .from('meetup_proposals')
    .insert({
      recovery_event_id: recovery.id,
      proposed_by: finderAuth.user.id,
      location_name: 'Test Park',
      proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      status: 'pending',
    })
    .select()
    .single();
  if (proposalError) throw proposalError;

  try {
    const response = await fetch(`${FUNCTION_URL}?id=${recovery.id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertExists(data.meetup_proposals);
    assertEquals(data.meetup_proposals.length, 1);
    assertEquals(data.meetup_proposals[0].location_name, 'Test Park');
  } finally {
    await supabaseAdmin.from('meetup_proposals').delete().eq('id', proposal.id);
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});
