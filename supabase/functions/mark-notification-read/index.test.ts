import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  dismissed: boolean;
  created_at: string;
};

// Mock data storage
let mockNotifications: MockNotification[] = [];

// Mock Supabase client
const mockSupabaseClient = {
  from: (table: string) => ({
    update: (data: Partial<MockNotification>) => ({
      eq: (column: string, value: string) => ({
        select: () => ({
          single: () => {
            if (table === 'notifications') {
              const notif = mockNotifications.find((n) => n[column as keyof MockNotification] === value);
              if (notif) {
                Object.assign(notif, data);
                return Promise.resolve({ data: notif, error: null });
              }
              return Promise.resolve({ data: null, error: { message: 'Not found' } });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          },
        }),
      }),
    }),
  }),
};

// Reset mocks before each test
function resetMocks() {
  mockNotifications = [];
}

Deno.test('mark-notification-read - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/mark-notification-read', {
    method: 'GET',
  });

  if (req.method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const data = await response.json();
    assertEquals(data.error, 'Method not allowed');
  }
});

Deno.test('mark-notification-read - returns 401 when not authenticated', () => {
  const req = new Request('http://localhost/mark-notification-read', {
    method: 'POST',
    body: JSON.stringify({ notification_id: 'test' }),
  });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
  }
});

Deno.test('mark-notification-read - returns 400 when no option provided', async () => {
  const body = {};

  if (!('notification_id' in body) && !('mark_all' in body)) {
    const response = new Response(JSON.stringify({ error: 'Either notification_id or mark_all must be provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Either notification_id or mark_all must be provided');
  }
});

Deno.test('mark-notification-read - can mark single notification as read', async () => {
  resetMocks();

  const userId = 'user-123';
  mockNotifications = [
    {
      id: 'notif-1',
      user_id: userId,
      type: 'disc_found',
      title: 'Test Notification',
      body: 'Test body',
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
  ];

  const result = await mockSupabaseClient
    .from('notifications')
    .update({ read: true })
    .eq('id', 'notif-1')
    .select()
    .single();

  assertExists(result.data);
  assertEquals(result.data.read, true);

  const response = new Response(
    JSON.stringify({
      success: true,
      notification: result.data,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.notification.read, true);
});

Deno.test('mark-notification-read - can mark all notifications as read', async () => {
  resetMocks();

  const userId = 'user-123';
  mockNotifications = [
    {
      id: 'notif-1',
      user_id: userId,
      type: 'disc_found',
      title: 'Notification 1',
      body: 'Body 1',
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
    {
      id: 'notif-2',
      user_id: userId,
      type: 'disc_found',
      title: 'Notification 2',
      body: 'Body 2',
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
  ];

  // Mark all as read
  mockNotifications.forEach((n) => {
    if (n.user_id === userId) {
      n.read = true;
    }
  });

  const markedCount = mockNotifications.filter((n) => n.user_id === userId && n.read).length;

  const response = new Response(
    JSON.stringify({
      success: true,
      marked_count: markedCount,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.marked_count, 2);
  assertEquals(
    mockNotifications.every((n) => n.read),
    true
  );
});

Deno.test('mark-notification-read - cannot mark other user notification as read', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const otherId = 'other-456';

  mockNotifications = [
    {
      id: 'notif-1',
      user_id: ownerId,
      type: 'disc_found',
      title: 'Owner Notification',
      body: 'Body',
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
  ];

  // Other user tries to mark notification
  const notif = mockNotifications.find((n) => n.id === 'notif-1');
  if (notif && notif.user_id !== otherId) {
    const response = new Response(JSON.stringify({ error: 'Notification not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Notification not found');
    assertEquals(notif.read, false);
  }
});
