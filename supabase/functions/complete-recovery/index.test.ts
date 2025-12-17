import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/complete-recovery';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

Deno.test('complete-recovery: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
  });
  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('complete-recovery: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recovery_event_id: 'test-id' }),
  });
  assertEquals(response.status, 401);
});

Deno.test('complete-recovery: should return 400 when recovery_event_id is missing', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
    body: JSON.stringify({}),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: recovery_event_id');
});

Deno.test('complete-recovery: should return 404 when recovery event not found', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
    body: JSON.stringify({ recovery_event_id: '00000000-0000-0000-0000-000000000000' }),
  });

  assertEquals(response.status, 404);
  const data = await response.json();
  assertEquals(data.error, 'Recovery event not found');
});

Deno.test('complete-recovery: should return 403 when user is not disc owner', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create disc owner
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  // Create a disc owned by owner
  const { data: disc } = await ownerClient
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const finderClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${finderAuth.session?.access_token}` } },
  });

  // Create recovery event
  const { data: recoveryEvent } = await finderClient
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user?.id,
      status: 'meetup_scheduled',
    })
    .select()
    .single();

  // Random user tries to complete
  const { data: randomAuth } = await supabase.auth.signUp({
    email: `random-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${randomAuth.session?.access_token}`,
    },
    body: JSON.stringify({ recovery_event_id: recoveryEvent.id }),
  });

  assertEquals(response.status, 403);
  const data = await response.json();
  assertEquals(data.error, 'Only the disc owner can complete the recovery');
});

Deno.test('complete-recovery: owner can complete a recovery', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create disc owner
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  // Create a disc owned by owner
  const { data: disc } = await ownerClient
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const finderClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${finderAuth.session?.access_token}` } },
  });

  // Create recovery event
  const { data: recoveryEvent } = await finderClient
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user?.id,
      status: 'meetup_scheduled',
    })
    .select()
    .single();

  // Create accepted meetup proposal
  const { data: proposal } = await finderClient
    .from('meetup_proposals')
    .insert({
      recovery_event_id: recoveryEvent.id,
      proposed_by: finderAuth.user?.id,
      location_name: 'Maple Hill DGC',
      proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      status: 'accepted',
    })
    .select()
    .single();

  // Owner completes the recovery
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerAuth.session?.access_token}`,
    },
    body: JSON.stringify({ recovery_event_id: recoveryEvent.id }),
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.recovery_event);
  assertEquals(data.recovery_event.status, 'returned');

  // Verify meetup proposal status was updated
  const { data: updatedProposal } = await ownerClient
    .from('meetup_proposals')
    .select('status')
    .eq('id', proposal.id)
    .single();

  assertEquals(updatedProposal?.status, 'completed');
});

Deno.test('complete-recovery: owner can complete a dropped_off recovery', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create disc owner
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  // Create a disc owned by owner
  const { data: disc } = await ownerClient
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  // Create recovery event with dropped_off status using admin client
  const { data: recoveryEvent, error: recErr } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc!.id,
      finder_id: finderAuth.user?.id,
      status: 'dropped_off',
    })
    .select()
    .single();

  if (recErr) {
    throw recErr;
  }

  // Owner completes the recovery
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerAuth.session?.access_token}`,
    },
    body: JSON.stringify({ recovery_event_id: recoveryEvent.id }),
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.recovery_event);
  assertEquals(data.recovery_event.status, 'recovered');

  // Clean up
  await supabaseAdmin.from('recovery_events').delete().eq('id', recoveryEvent.id);
  await supabaseAdmin.from('discs').delete().eq('id', disc!.id);
  await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user!.id);
  await supabaseAdmin.auth.admin.deleteUser(finderAuth.user!.id);
});

Deno.test('complete-recovery: should reject already completed recoveries', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create disc owner
  const { data: ownerAuth } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${ownerAuth.session?.access_token}` } },
  });

  // Create a disc owned by owner
  const { data: disc } = await ownerClient
    .from('discs')
    .insert({
      name: 'Test Disc',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Create finder
  const { data: finderAuth } = await supabase.auth.signUp({
    email: `finder-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const finderClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${finderAuth.session?.access_token}` } },
  });

  // Create already completed recovery event
  const { data: recoveryEvent } = await finderClient
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: finderAuth.user?.id,
      status: 'returned',
    })
    .select()
    .single();

  // Owner tries to complete again
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerAuth.session?.access_token}`,
    },
    body: JSON.stringify({ recovery_event_id: recoveryEvent.id }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'This recovery has already been completed');
});
