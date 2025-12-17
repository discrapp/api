import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/get-my-finds';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('get-my-finds: should return 405 for non-GET requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('get-my-finds: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('get-my-finds: returns empty array when user has no finds', async () => {
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

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(Array.isArray(data), true);
    assertEquals(data.length, 0);
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('get-my-finds: returns recovery events where user is finder', async () => {
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
    .insert({
      owner_id: ownerAuth.user.id,
      name: 'Found Disc',
      mold: 'Destroyer',
      manufacturer: 'Innova',
      color: 'Blue',
      reward_amount: 15,
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
      finder_message: 'Found this disc!',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(Array.isArray(data), true);
    assertEquals(data.length, 1);
    assertEquals(data[0].id, recovery.id);
    assertEquals(data[0].status, 'found');
    assertEquals(data[0].finder_message, 'Found this disc!');
    assertExists(data[0].disc);
    assertEquals(data[0].disc.name, 'Found Disc');
    assertEquals(data[0].disc.manufacturer, 'Innova');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('get-my-finds: excludes completed recoveries', async () => {
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
    .insert({ owner_id: ownerAuth.user.id, name: 'Recovered Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create completed recovery event (should be excluded)
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'recovered',
      found_at: new Date().toISOString(),
      recovered_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    // Should not include recovered events
    assertEquals(data.length, 0);
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('get-my-finds: includes abandoned recoveries', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.session || !finderAuth.user) {
    throw finderError || new Error('No session');
  }

  // Create disc with no owner (abandoned)
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({ owner_id: null, name: 'Abandoned Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create abandoned recovery event
  const { data: recovery, error: recoveryError } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user.id,
      status: 'abandoned',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.length, 1);
    assertEquals(data[0].status, 'abandoned');
    assertEquals(data[0].disc.owner_display_name, 'No owner');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('get-my-finds: does not return finds for other users', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create owner
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create actual finder
  const { data: finderAuth, error: finderError } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (finderError || !finderAuth.user) throw finderError || new Error('No user');

  // Create other user (will request finds)
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

  // Create recovery event where finderAuth is the finder
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
    // Other user should not see this find
    const response = await fetch(FUNCTION_URL, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherAuth.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.length, 0);
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(otherAuth.user.id);
  }
});
