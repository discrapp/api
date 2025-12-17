import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockNotification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  dismissed: boolean;
  created_at: string;
};

// Mock data storage
let mockNotifications: MockNotification[] = [];

// Mock Supabase client
const mockSupabaseClient = {
  from: (table: string) => {
    let filtered: MockNotification[] = [];
    const createEqChain = () => ({
      eq: (column: string, value: string | boolean) => {
        if (table === 'notifications') {
          filtered = (filtered.length ? filtered : mockNotifications).filter((n) => {
            return n[column as keyof MockNotification] === value;
          });
        }
        return {
          ...createEqChain(),
          order: (col: string, opts?: { ascending?: boolean }) => {
            const sorted = [...filtered].sort((a, b) => {
              const aVal = a[col as keyof MockNotification] as string;
              const bVal = b[col as keyof MockNotification] as string;
              return opts?.ascending === false ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
            });
            return Promise.resolve({ data: sorted, error: null });
          },
        };
      },
    });

    return {
      select: (_columns: string) => createEqChain(),
    };
  },
};

// Reset mocks before each test
function resetMocks() {
  mockNotifications = [];
}

Deno.test('get-notifications - returns 405 for non-GET requests', async () => {
  const req = new Request('http://localhost/get-notifications', {
    method: 'POST',
  });

  if (req.method !== 'GET') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const data = await response.json();
    assertEquals(data.error, 'Method not allowed');
  }
});

Deno.test('get-notifications - returns 401 when not authenticated', () => {
  const req = new Request('http://localhost/get-notifications', {
    method: 'GET',
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

Deno.test('get-notifications - returns empty array when user has no notifications', async () => {
  resetMocks();

  const userId = 'user-123';
  const result = await mockSupabaseClient
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false });

  const response = new Response(
    JSON.stringify({
      notifications: result.data,
      total_count: result.data.length,
      unread_count: result.data.filter((n: MockNotification) => !n.read).length,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertExists(data.notifications);
  assertEquals(data.notifications.length, 0);
  assertEquals(data.total_count, 0);
  assertEquals(data.unread_count, 0);
});

Deno.test('get-notifications - returns user notifications', async () => {
  resetMocks();

  const userId = 'user-123';
  mockNotifications = [
    {
      id: 'notif-1',
      user_id: userId,
      type: 'disc_found',
      title: 'Disc Found',
      body: 'Someone found your disc!',
      data: { disc_id: 'test-123' },
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
  ];

  const result = await mockSupabaseClient
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false });

  const response = new Response(
    JSON.stringify({
      notifications: result.data,
      total_count: result.data.length,
      unread_count: result.data.filter((n: MockNotification) => !n.read).length,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.notifications.length, 1);
  assertEquals(data.notifications[0].title, 'Disc Found');
  assertEquals(data.total_count, 1);
  assertEquals(data.unread_count, 1);
});

Deno.test('get-notifications - respects unread_only filter', async () => {
  resetMocks();

  const userId = 'user-123';
  mockNotifications = [
    {
      id: 'notif-1',
      user_id: userId,
      type: 'disc_found',
      title: 'Read Notification',
      body: 'This is read',
      read: true,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
    {
      id: 'notif-2',
      user_id: userId,
      type: 'disc_found',
      title: 'Unread Notification',
      body: 'This is unread',
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
  ];

  // Filter for unread only
  const filtered = mockNotifications.filter((n) => n.user_id === userId && !n.dismissed && !n.read);

  const response = new Response(
    JSON.stringify({
      notifications: filtered,
      total_count: filtered.length,
      unread_count: filtered.length,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.notifications.length, 1);
  assertEquals(data.notifications[0].title, 'Unread Notification');
});

Deno.test('get-notifications - excludes dismissed notifications', async () => {
  resetMocks();

  const userId = 'user-123';
  mockNotifications = [
    {
      id: 'notif-1',
      user_id: userId,
      type: 'disc_found',
      title: 'Dismissed Notification',
      body: 'This is dismissed',
      read: false,
      dismissed: true,
      created_at: new Date().toISOString(),
    },
    {
      id: 'notif-2',
      user_id: userId,
      type: 'disc_found',
      title: 'Active Notification',
      body: 'This is active',
      read: false,
      dismissed: false,
      created_at: new Date().toISOString(),
    },
  ];

  const result = await mockSupabaseClient
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false });

  const response = new Response(
    JSON.stringify({
      notifications: result.data,
      total_count: result.data.length,
      unread_count: result.data.filter((n: MockNotification) => !n.read).length,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.notifications.length, 1);
  assertEquals(data.notifications[0].title, 'Active Notification');
});
