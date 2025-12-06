import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/accept-meetup';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

Deno.test('accept-meetup: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
  });
  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('accept-meetup: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ proposal_id: 'test-id' }),
  });
  assertEquals(response.status, 401);
});

Deno.test('accept-meetup: should return 400 when proposal_id is missing', async () => {
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
  assertEquals(data.error, 'Missing required field: proposal_id');
});

Deno.test('accept-meetup: should return 404 when proposal not found', async () => {
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
    body: JSON.stringify({ proposal_id: '00000000-0000-0000-0000-000000000000' }),
  });

  assertEquals(response.status, 404);
  const data = await response.json();
  assertEquals(data.error, 'Meetup proposal not found');
});

Deno.test('accept-meetup: should return 403 when user is not the disc owner', async () => {
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
      status: 'found',
    })
    .select()
    .single();

  // Create meetup proposal by finder
  const { data: proposal } = await finderClient
    .from('meetup_proposals')
    .insert({
      recovery_event_id: recoveryEvent.id,
      proposed_by: finderAuth.user?.id,
      location_name: 'Test Location',
      proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      status: 'proposed',
    })
    .select()
    .single();

  // Create random user trying to accept
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
    body: JSON.stringify({ proposal_id: proposal.id }),
  });

  assertEquals(response.status, 403);
  const data = await response.json();
  assertEquals(data.error, 'Only the disc owner can accept meetup proposals');
});

Deno.test('accept-meetup: owner can accept a meetup proposal', async () => {
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
      status: 'found',
    })
    .select()
    .single();

  // Create meetup proposal by finder
  const { data: proposal } = await finderClient
    .from('meetup_proposals')
    .insert({
      recovery_event_id: recoveryEvent.id,
      proposed_by: finderAuth.user?.id,
      location_name: 'Maple Hill DGC Parking Lot',
      proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      status: 'proposed',
    })
    .select()
    .single();

  // Owner accepts the proposal
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerAuth.session?.access_token}`,
    },
    body: JSON.stringify({ proposal_id: proposal.id }),
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.proposal);
  assertEquals(data.proposal.status, 'accepted');

  // Verify recovery event status was updated
  const { data: updatedEvent } = await ownerClient
    .from('recovery_events')
    .select('status')
    .eq('id', recoveryEvent.id)
    .single();

  assertEquals(updatedEvent?.status, 'meetup_scheduled');
});

Deno.test('accept-meetup: should reject already accepted proposals', async () => {
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

  // Create already accepted proposal
  const { data: proposal } = await finderClient
    .from('meetup_proposals')
    .insert({
      recovery_event_id: recoveryEvent.id,
      proposed_by: finderAuth.user?.id,
      location_name: 'Test Location',
      proposed_datetime: new Date(Date.now() + 86400000).toISOString(),
      status: 'accepted',
    })
    .select()
    .single();

  // Owner tries to accept again
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerAuth.session?.access_token}`,
    },
    body: JSON.stringify({ proposal_id: proposal.id }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'This proposal has already been accepted or rejected');
});
