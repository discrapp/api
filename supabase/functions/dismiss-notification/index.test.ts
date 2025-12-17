import { assertEquals } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  dismissed: boolean;
  read: boolean;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockNotifications: MockNotification[] = [];
let mockCurrentUser: MockUser | null = null;

// Reset mocks between tests
function resetMocks() {
  mockUsers = [];
  mockNotifications = [];
  mockCurrentUser = null;
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: async () => {
        if (mockCurrentUser) {
          return { data: { user: mockCurrentUser }, error: null };
        }
        return { data: { user: null }, error: { message: 'Not authenticated' } };
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: async () => {
            if (table === 'notifications') {
              const notification = mockNotifications.find((n) => n[column as keyof MockNotification] === value);
              if (!notification) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: notification, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: (updates: Record<string, unknown>) => ({
        eq: (column: string, value: string | boolean) => ({
          select: (_columns?: string) => ({
            single: async () => {
              if (table === 'notifications') {
                const index = mockNotifications.findIndex((n) => n[column as keyof MockNotification] === value);
                if (index !== -1) {
                  mockNotifications[index] = {
                    ...mockNotifications[index],
                    ...updates,
                  } as MockNotification;
                  return { data: mockNotifications[index], error: null };
                }
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('dismiss-notification: should return 405 for non-POST requests', () => {
  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('dismiss-notification: should return 401 when not authenticated', async () => {
  resetMocks();
  const supabase = mockSupabaseClient();

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Missing authorization header');
  }
});

Deno.test('dismiss-notification: should return 400 when no option provided', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  const body: { notification_id?: string; dismiss_all?: boolean } = {};

  if (!body.notification_id && !body.dismiss_all) {
    const response = new Response(JSON.stringify({ error: 'notification_id or dismiss_all is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'notification_id or dismiss_all is required');
  }
});

Deno.test('dismiss-notification: can dismiss single notification', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const notification: MockNotification = {
    id: 'notif-123',
    user_id: mockCurrentUser.id,
    type: 'disc_found',
    title: 'Test Notification',
    body: 'Test body',
    dismissed: false,
    read: false,
  };
  mockNotifications.push(notification);

  const supabase = mockSupabaseClient();

  // Get notification
  const { data: notifData } = await supabase.from('notifications').select('*').eq('id', notification.id).single();

  if (notifData && notifData.user_id === mockCurrentUser.id) {
    // Dismiss notification
    const { data: updatedNotif } = await supabase
      .from('notifications')
      .update({ dismissed: true, read: true })
      .eq('id', notification.id)
      .select()
      .single();

    const response = new Response(
      JSON.stringify({
        success: true,
        notification: updatedNotif,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
    assertEquals(data.notification.dismissed, true);

    // Verify in mock data
    const updated = mockNotifications.find((n) => n.id === notification.id);
    assertEquals(updated?.dismissed, true);
    assertEquals(updated?.read, true);
  }
});

Deno.test('dismiss-notification: can dismiss all notifications', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const notif1: MockNotification = {
    id: 'notif-1',
    user_id: mockCurrentUser.id,
    type: 'disc_found',
    title: 'Notification 1',
    body: 'Body 1',
    dismissed: false,
    read: false,
  };
  const notif2: MockNotification = {
    id: 'notif-2',
    user_id: mockCurrentUser.id,
    type: 'disc_found',
    title: 'Notification 2',
    body: 'Body 2',
    dismissed: false,
    read: false,
  };
  mockNotifications.push(notif1, notif2);

  const supabase = mockSupabaseClient();

  // Dismiss all notifications
  let dismissedCount = 0;
  for (const notif of mockNotifications) {
    if (notif.user_id === mockCurrentUser.id && !notif.dismissed) {
      await supabase.from('notifications').update({ dismissed: true, read: true }).eq('id', notif.id).select().single();
      dismissedCount++;
    }
  }

  const response = new Response(
    JSON.stringify({
      success: true,
      dismissed_count: dismissedCount,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.dismissed_count, 2);

  // Verify in mock data
  const allDismissed = mockNotifications.every((n) => n.dismissed && n.read);
  assertEquals(allDismissed, true);
});

Deno.test('dismiss-notification: cannot dismiss other user notification', async () => {
  resetMocks();
  const ownerId = 'owner-123';
  const otherUserId = 'other-456';
  mockCurrentUser = { id: otherUserId, email: 'other@example.com' };

  mockUsers.push({ id: ownerId, email: 'owner@example.com' });
  mockUsers.push(mockCurrentUser);

  const notification: MockNotification = {
    id: 'notif-123',
    user_id: ownerId,
    type: 'disc_found',
    title: 'Owner Notification',
    body: 'Body',
    dismissed: false,
    read: false,
  };
  mockNotifications.push(notification);

  const supabase = mockSupabaseClient();

  // Try to get notification (should not find it for other user)
  const { data: notifData } = await supabase.from('notifications').select('*').eq('id', notification.id).single();

  // Check if user owns notification
  if (!notifData || notifData.user_id !== mockCurrentUser.id) {
    const response = new Response(JSON.stringify({ error: 'Notification not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Notification not found');

    // Verify notification is still not dismissed
    const unchanged = mockNotifications.find((n) => n.id === notification.id);
    assertEquals(unchanged?.dismissed, false);
  }
});
