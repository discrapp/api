import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/propose-meetup';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('propose-meetup: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('propose-meetup: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recovery_event_id: 'test' }),
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('propose-meetup: should return 400 when required fields are missing', async () => {
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
    assertEquals(data.error, 'Missing required fields: recovery_event_id, location_name, proposed_datetime');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('propose-meetup: should return 404 for non-existent recovery event', async () => {
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
        location_name: 'Test Park',
        proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      }),
    });

    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Recovery event not found');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('propose-meetup: should return 403 when user is not a participant', async () => {
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

  // Create uninvolved user (will try to propose)
  const { data: uninvolvedAuth, error: uninvolvedError } = await supabase.auth.signUp({
    email: `uninvolved-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (uninvolvedError || !uninvolvedAuth.session || !uninvolvedAuth.user) {
    throw uninvolvedError || new Error('No session');
  }

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
    // Uninvolved user tries to propose meetup
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${uninvolvedAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        location_name: 'Test Park',
        proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      }),
    });

    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You are not a participant in this recovery');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(uninvolvedAuth.user.id);
  }
});

Deno.test('propose-meetup: finder can successfully propose meetup', async () => {
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

  let proposalId: string | null = null;
  const proposedDatetime = new Date(Date.now() + 86400000).toISOString();

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        location_name: 'Central Park',
        latitude: 40.785091,
        longitude: -73.968285,
        proposed_datetime: proposedDatetime,
        message: 'Meet by the fountain',
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertExists(data.proposal);
    assertExists(data.proposal.id);
    assertEquals(data.proposal.recovery_event_id, recovery.id);
    assertEquals(data.proposal.location_name, 'Central Park');
    assertEquals(data.proposal.status, 'pending');
    assertEquals(data.proposal.message, 'Meet by the fountain');
    assertEquals(data.proposal.proposed_by, finderAuth.user.id);

    proposalId = data.proposal.id;

    // Verify recovery event status was updated
    const { data: updatedRecovery } = await supabaseAdmin
      .from('recovery_events')
      .select('status')
      .eq('id', recovery.id)
      .single();
    assertEquals(updatedRecovery?.status, 'meetup_proposed');
  } finally {
    if (proposalId) {
      await supabaseAdmin.from('meetup_proposals').delete().eq('id', proposalId);
    }
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('propose-meetup: owner can successfully propose meetup', async () => {
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
      status: 'found',
      found_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (recoveryError) throw recoveryError;

  let proposalId: string | null = null;

  try {
    // Owner proposes meetup
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        location_name: 'My Local Course',
        proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.proposal.proposed_by, ownerAuth.user.id);

    proposalId = data.proposal.id;
  } finally {
    if (proposalId) {
      await supabaseAdmin.from('meetup_proposals').delete().eq('id', proposalId);
    }
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('propose-meetup: works without optional fields', async () => {
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

  let proposalId: string | null = null;

  try {
    // Propose without optional lat/long/message
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finderAuth.session.access_token}`,
      },
      body: JSON.stringify({
        recovery_event_id: recovery.id,
        location_name: 'Some Location',
        proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.proposal.latitude, null);
    assertEquals(data.proposal.longitude, null);
    assertEquals(data.proposal.message, null);

    proposalId = data.proposal.id;
  } finally {
    if (proposalId) {
      await supabaseAdmin.from('meetup_proposals').delete().eq('id', proposalId);
    }
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});

Deno.test('propose-meetup: should return 400 for recovery that is already completed', async () => {
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

  // Create recovery event that is already recovered
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
        location_name: 'Test Park',
        proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      }),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Cannot propose meetup for a completed or cancelled recovery');
  } finally {
    await supabaseAdmin.from('recovery_events').delete().eq('id', recovery.id);
    await supabaseAdmin.from('discs').delete().eq('id', disc.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(finderAuth.user.id);
  }
});
