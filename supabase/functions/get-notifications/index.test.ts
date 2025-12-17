import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/get-notifications';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('get-notifications: should return 405 for non-GET requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('get-notifications: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('get-notifications: returns empty array when user has no notifications', async () => {
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
    assertExists(data.notifications);
    assertEquals(data.notifications.length, 0);
    assertEquals(data.total_count, 0);
    assertEquals(data.unread_count, 0);
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('get-notifications: returns user notifications', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create notifications
  const { data: notification, error: notifError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Disc Found',
      body: 'Someone found your disc!',
      data: { disc_id: 'test-123' },
    })
    .select()
    .single();
  if (notifError) throw notifError;

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
    assertEquals(data.notifications.length, 1);
    assertEquals(data.notifications[0].title, 'Disc Found');
    assertEquals(data.total_count, 1);
    assertEquals(data.unread_count, 1);
  } finally {
    await supabaseAdmin.from('notifications').delete().eq('id', notification.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('get-notifications: respects unread_only filter', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create read notification
  const { data: readNotif, error: readError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Read Notification',
      body: 'This is read',
      read: true,
    })
    .select()
    .single();
  if (readError) throw readError;

  // Create unread notification
  const { data: unreadNotif, error: unreadError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Unread Notification',
      body: 'This is unread',
      read: false,
    })
    .select()
    .single();
  if (unreadError) throw unreadError;

  try {
    // Request unread only
    const response = await fetch(`${FUNCTION_URL}?unread_only=true`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.notifications.length, 1);
    assertEquals(data.notifications[0].title, 'Unread Notification');
  } finally {
    await supabaseAdmin.from('notifications').delete().eq('id', readNotif.id);
    await supabaseAdmin.from('notifications').delete().eq('id', unreadNotif.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('get-notifications: excludes dismissed notifications', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create dismissed notification
  const { data: dismissedNotif, error: dismissedError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Dismissed Notification',
      body: 'This is dismissed',
      dismissed: true,
    })
    .select()
    .single();
  if (dismissedError) throw dismissedError;

  // Create active notification
  const { data: activeNotif, error: activeError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Active Notification',
      body: 'This is active',
      dismissed: false,
    })
    .select()
    .single();
  if (activeError) throw activeError;

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
    assertEquals(data.notifications.length, 1);
    assertEquals(data.notifications[0].title, 'Active Notification');
  } finally {
    await supabaseAdmin.from('notifications').delete().eq('id', dismissedNotif.id);
    await supabaseAdmin.from('notifications').delete().eq('id', activeNotif.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});
