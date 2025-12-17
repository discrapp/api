import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/create-notification';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('create-notification: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('create-notification: should return 400 when user_id is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'disc_found',
      title: 'Test',
      body: 'Test body',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: user_id');
});

Deno.test('create-notification: should return 400 when type is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: '123',
      title: 'Test',
      body: 'Test body',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: type');
});

Deno.test('create-notification: should return 400 for invalid type', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: '123',
      type: 'invalid_type',
      title: 'Test',
      body: 'Test body',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error.includes('Invalid notification type'), true);
});

Deno.test('create-notification: should return 400 when title is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: '123',
      type: 'disc_found',
      body: 'Test body',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: title');
});

Deno.test('create-notification: should return 400 when body is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: '123',
      type: 'disc_found',
      title: 'Test',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: body');
});

Deno.test('create-notification: successfully creates disc_found notification', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create a test user
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.user) {
    throw signUpError || new Error('No user');
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: authData.user.id,
        type: 'disc_found',
        title: 'Your disc was found!',
        body: 'Someone found your disc at the course.',
        data: { disc_id: 'test-disc-123' },
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertExists(data.notification);
    assertEquals(data.notification.type, 'disc_found');
    assertEquals(data.notification.title, 'Your disc was found!');
    assertEquals(data.notification.read, false);
    assertExists(data.notification.id);

    // Cleanup
    await supabaseAdmin.from('notifications').delete().eq('id', data.notification.id);
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('create-notification: successfully creates meetup_proposed notification', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.user) {
    throw signUpError || new Error('No user');
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: authData.user.id,
        type: 'meetup_proposed',
        title: 'Meetup proposed',
        body: 'Someone proposed a meetup for your disc.',
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.notification.type, 'meetup_proposed');

    await supabaseAdmin.from('notifications').delete().eq('id', data.notification.id);
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('create-notification: works without optional data field', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.user) {
    throw signUpError || new Error('No user');
  }

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: authData.user.id,
        type: 'disc_recovered',
        title: 'Disc recovered!',
        body: 'Your disc has been recovered.',
      }),
    });

    assertEquals(response.status, 201);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.notification.type, 'disc_recovered');

    await supabaseAdmin.from('notifications').delete().eq('id', data.notification.id);
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
