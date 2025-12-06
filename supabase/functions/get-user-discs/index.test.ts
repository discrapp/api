import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/get-user-discs';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

Deno.test('get-user-discs: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
  });

  assertEquals(response.status, 401);
});

Deno.test('get-user-discs: should return empty array for new user', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(Array.isArray(data), true);
  assertEquals(data.length, 0);
});

Deno.test('get-user-discs: should return user discs with photos', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } },
  });

  // Create two discs
  const { data: disc1 } = await supabaseAuth
    .from('discs')
    .insert({
      name: 'Innova Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    })
    .select()
    .single();

  const { data: disc2 } = await supabaseAuth
    .from('discs')
    .insert({
      name: 'Discraft Buzzz',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      flight_numbers: { speed: 5, glide: 4, turn: -1, fade: 1 },
    })
    .select()
    .single();

  // Add photos to first disc (photo_uuid is a UUID identifier)
  await supabaseAuth.from('disc_photos').insert([
    { disc_id: disc1.id, storage_path: 'test/path/photo1.jpg', photo_uuid: crypto.randomUUID() },
    { disc_id: disc1.id, storage_path: 'test/path/photo2.jpg', photo_uuid: crypto.randomUUID() },
  ]);

  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
  });

  assertEquals(response.status, 200);
  const data = (await response.json()) as Array<{
    id: string;
    name: string;
    manufacturer?: string;
    photos: Array<unknown>;
  }>;
  assertEquals(Array.isArray(data), true);
  assertEquals(data.length, 2);

  // Check disc structure
  const returnedDisc1 = data.find((d) => d.id === disc1.id);
  assertExists(returnedDisc1);
  assertEquals(returnedDisc1.name, 'Innova Destroyer');
  assertEquals(returnedDisc1.manufacturer, 'Innova');
  assertExists(returnedDisc1.photos);
  assertEquals(Array.isArray(returnedDisc1.photos), true);
  assertEquals(returnedDisc1.photos.length, 2);

  const returnedDisc2 = data.find((d) => d.id === disc2.id);
  assertExists(returnedDisc2);
  assertEquals(returnedDisc2.name, 'Discraft Buzzz');
  assertEquals(returnedDisc2.photos.length, 0);
});

Deno.test('get-user-discs: should only return own discs', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Create first user with disc
  const { data: user1Auth } = await supabase.auth.signUp({
    email: `test1-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabase1 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${user1Auth.session?.access_token}` } },
  });

  await supabase1.from('discs').insert({
    name: 'User 1 Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  });

  // Create second user with disc
  const { data: user2Auth } = await supabase.auth.signUp({
    email: `test2-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabase2 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${user2Auth.session?.access_token}` } },
  });

  await supabase2.from('discs').insert({
    name: 'User 2 Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  });

  // User 2 should only see their own disc
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${user2Auth.session?.access_token}`,
    },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.length, 1);
  assertEquals(data[0].name, 'User 2 Disc');
});

Deno.test('get-user-discs: should return discs ordered by newest first', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${authData.session?.access_token}` } },
  });

  // Create discs in order (with small delay to ensure different timestamps)
  await supabaseAuth
    .from('discs')
    .insert({ name: 'First Disc', flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 } })
    .select()
    .single();

  await new Promise((resolve) => setTimeout(resolve, 100));

  await supabaseAuth
    .from('discs')
    .insert({ name: 'Second Disc', flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 } })
    .select()
    .single();

  await new Promise((resolve) => setTimeout(resolve, 100));

  await supabaseAuth
    .from('discs')
    .insert({ name: 'Third Disc', flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 } })
    .select()
    .single();

  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authData.session?.access_token}`,
    },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.length, 3);
  // Newest first
  assertEquals(data[0].name, 'Third Disc');
  assertEquals(data[1].name, 'Second Disc');
  assertEquals(data[2].name, 'First Disc');
});
