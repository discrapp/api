import { assertEquals } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/send-push-notification';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('send-push-notification: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('send-push-notification: should return 400 when user_id is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Test',
      body: 'Test body',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: user_id');
});

Deno.test('send-push-notification: should return 400 when title is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: '123',
      body: 'Test body',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: title');
});

Deno.test('send-push-notification: should return 400 when body is missing', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: '123',
      title: 'Test',
    }),
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: body');
});

Deno.test('send-push-notification: skips when user has no push token', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create user without push token
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
        title: 'Test Notification',
        body: 'Test body',
      }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.skipped, true);
    assertEquals(data.reason, 'User has no push token registered');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
