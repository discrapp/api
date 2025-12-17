import { assertEquals } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FUNCTION_URL = Deno.env.get('FUNCTION_URL') || 'http://localhost:54321/functions/v1/dismiss-notification';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  Deno.env.get('SUPABASE_ANON_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

Deno.test('dismiss-notification: should return 405 for non-POST requests', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('dismiss-notification: should return 401 when not authenticated', async () => {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notification_id: 'test' }),
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('dismiss-notification: should return 400 when no option provided', async () => {
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({}),
    });

    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'notification_id or dismiss_all is required');
  } finally {
    await supabaseAdmin.auth.admin.deleteUser(authData.user!.id);
  }
});

Deno.test('dismiss-notification: can dismiss single notification', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create notification
  const { data: notification, error: notifError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Test Notification',
      body: 'Test body',
      dismissed: false,
    })
    .select()
    .single();
  if (notifError) throw notifError;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ notification_id: notification.id }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.notification.dismissed, true);

    // Verify in database
    const { data: updated } = await supabaseAdmin
      .from('notifications')
      .select('dismissed, read')
      .eq('id', notification.id)
      .single();
    assertEquals(updated?.dismissed, true);
    assertEquals(updated?.read, true); // Should also be marked as read
  } finally {
    await supabaseAdmin.from('notifications').delete().eq('id', notification.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('dismiss-notification: can dismiss all notifications', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email: `test-${Date.now()}@example.com`,
    password: 'testpassword123',
  });

  if (signUpError || !authData.session || !authData.user) {
    throw signUpError || new Error('No session');
  }

  // Create multiple notifications
  const { data: notif1, error: notif1Error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Notification 1',
      body: 'Body 1',
      dismissed: false,
    })
    .select()
    .single();
  if (notif1Error) throw notif1Error;

  const { data: notif2, error: notif2Error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: authData.user.id,
      type: 'disc_found',
      title: 'Notification 2',
      body: 'Body 2',
      dismissed: false,
    })
    .select()
    .single();
  if (notif2Error) throw notif2Error;

  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
      },
      body: JSON.stringify({ dismiss_all: true }),
    });

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.dismissed_count, 2);

    // Verify in database
    const { data: notifications } = await supabaseAdmin
      .from('notifications')
      .select('dismissed, read')
      .eq('user_id', authData.user.id);
    assertEquals(
      notifications?.every((n) => n.dismissed && n.read),
      true
    );
  } finally {
    await supabaseAdmin.from('notifications').delete().eq('id', notif1.id);
    await supabaseAdmin.from('notifications').delete().eq('id', notif2.id);
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
  }
});

Deno.test('dismiss-notification: cannot dismiss other user notification', async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Create owner of notification
  const { data: ownerAuth, error: ownerError } = await supabase.auth.signUp({
    email: `owner-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (ownerError || !ownerAuth.user) throw ownerError || new Error('No user');

  // Create other user trying to dismiss
  const { data: otherAuth, error: otherError } = await supabase.auth.signUp({
    email: `other-${Date.now()}@example.com`,
    password: 'testpassword123',
  });
  if (otherError || !otherAuth.session || !otherAuth.user) {
    throw otherError || new Error('No session');
  }

  // Create notification for owner
  const { data: notification, error: notifError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: ownerAuth.user.id,
      type: 'disc_found',
      title: 'Owner Notification',
      body: 'Body',
      dismissed: false,
    })
    .select()
    .single();
  if (notifError) throw notifError;

  try {
    // Other user tries to dismiss owner's notification
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherAuth.session.access_token}`,
      },
      body: JSON.stringify({ notification_id: notification.id }),
    });

    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Notification not found');

    // Verify notification is still not dismissed
    const { data: unchanged } = await supabaseAdmin
      .from('notifications')
      .select('dismissed')
      .eq('id', notification.id)
      .single();
    assertEquals(unchanged?.dismissed, false);
  } finally {
    await supabaseAdmin.from('notifications').delete().eq('id', notification.id);
    await supabaseAdmin.auth.admin.deleteUser(ownerAuth.user.id);
    await supabaseAdmin.auth.admin.deleteUser(otherAuth.user.id);
  }
});
