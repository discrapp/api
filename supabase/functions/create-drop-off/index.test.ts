import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/create-drop-off';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('create-drop-off: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('create-drop-off: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recovery_event_id: 'test' }),
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('create-drop-off: should return 400 when required fields are missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session) {
    throw signUpError || new Error('No session');
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    assertEquals(data.error, 'Missing required fields: recovery_event_id, photo_url, latitude, longitude');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('create-drop-off: should return 404 for non-existent recovery event', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session) {
    throw signUpError || new Error('No session');
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: '00000000-0000-0000-0000-000000000000',
        photo_url: 'https://example.com/photo.jpg',
        latitude: 40.785091,
        longitude: -73.968285,
      }),
    });

    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Recovery event not found');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('create-drop-off: should return 403 when user is not the finder', async () => {
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

  // Create disc owned by owner
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .insert({ owner_id: ownerAuth.user.id, name: 'Test Disc', mold: 'Destroyer' })
    .select()
    .single();
  if (discError) throw discError;

  // Create recovery event (finder found the disc)
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
    // Owner tries to create drop-off (should fail - only finder can)
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        photo_url: 'https://example.com/photo.jpg',
        latitude: 40.785091,
        longitude: -73.968285,
      }),
    });

    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Only the finder can create a drop-off');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('create-drop-off: should return 400 for recovery not in found status', async () => {
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

  // Create recovery event with status already 'recovered'
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        photo_url: 'https://example.com/photo.jpg',
        latitude: 40.785091,
        longitude: -73.968285,
      }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Can only create drop-off for a recovery in found status');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('create-drop-off: finder can successfully create drop-off', async () => {
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

  let dropOffId: string | null = null;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        photo_url: 'https://example.com/drop-location.jpg',
        latitude: 40.785091,
        longitude: -73.968285,
        location_notes: 'Behind the big oak tree near hole 7',
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertExists(data.drop_off);
    assertExists(data.drop_off.id);
    assertEquals(data.drop_off.recovery_event_id, recovery.id);
    assertEquals(data.drop_off.photo_url, 'https://example.com/drop-location.jpg');
    assertEquals(data.drop_off.location_notes, 'Behind the big oak tree near hole 7');

    dropOffId = data.drop_off.id;

    // Verify recovery event status was updated
    const { data: updatedRecovery } = await supabaseAdmin
      .from('recovery_events')
      .select('status')
      .eq('id', recovery.id)
      .single();
    assertEquals(updatedRecovery?.status, 'dropped_off');
  } finally {
    if (dropOffId) {
      await supabaseAdmin.from('drop_offs').delete().eq('id', dropOffId);
    }
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('create-drop-off: works without optional location_notes', async () => {
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

  let dropOffId: string | null = null;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        photo_url: 'https://example.com/drop-location.jpg',
        latitude: 40.785091,
        longitude: -73.968285,
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.drop_off.location_notes, null);

    dropOffId = data.drop_off.id;
  } finally {
    if (dropOffId) {
      await supabaseAdmin.from('drop_offs').delete().eq('id', dropOffId);
    }
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('create-drop-off: creates notification for owner', async () => {
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

  let dropOffId: string | null = null;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        photo_url: 'https://example.com/drop-location.jpg',
        latitude: 40.785091,
        longitude: -73.968285,
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    dropOffId = data.drop_off.id;

    // Verify notification was created for owner
    const { data: notifications } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', ownerAuth.user.id)
      .eq('type', 'disc_dropped_off')
      .order('created_at', { ascending: false })
      .limit(1);

    assertExists(notifications);
    assertEquals(notifications.length, 1);
    assertEquals(notifications[0].type, 'disc_dropped_off');
    assertExists(notifications[0].data.recovery_event_id);
  } finally {
    // Clean up notifications
    await supabaseAdmin.from('notifications').delete().eq('user_id', ownerAuth.user.id).eq('type', 'disc_dropped_off');
    if (dropOffId) {
      await supabaseAdmin.from('drop_offs').delete().eq('id', dropOffId);
    }
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});
