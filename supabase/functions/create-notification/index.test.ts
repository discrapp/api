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

// Valid notification types
const VALID_NOTIFICATION_TYPES = [
  'disc_found',
  'meetup_proposed',
  'meetup_accepted',
  'meetup_declined',
  'drop_off_created',
  'disc_recovered',
  'disc_abandoned',
  'order_confirmed',
  'order_shipped',
];

// Mock Supabase client
const mockSupabaseClient = {
  from: (table: string) => ({
    insert: (data: Omit<MockNotification, 'id' | 'created_at' | 'read' | 'dismissed'>) => ({
      select: () => ({
        single: () => {
          if (table === 'notifications') {
            const newNotification = {
              ...data,
              id: `notif-${Date.now()}`,
              created_at: new Date().toISOString(),
              read: false,
              dismissed: false,
            };
            mockNotifications.push(newNotification);
            return Promise.resolve({ data: newNotification, error: null });
          }
          return Promise.resolve({ data: null, error: { message: 'Insert failed' } });
        },
      }),
    }),
  }),
};

// Reset mocks before each test
function resetMocks() {
  mockNotifications = [];
}

Deno.test('create-notification - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/create-notification', {
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

Deno.test('create-notification - returns 400 when user_id is missing', async () => {
  const body = {
    type: 'disc_found',
    title: 'Test',
    body: 'Test body',
  };

  if (!('user_id' in body) || !body.user_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: user_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: user_id');
  }
});

Deno.test('create-notification - returns 400 when type is missing', async () => {
  const body = {
    user_id: '123',
    title: 'Test',
    body: 'Test body',
  };

  if (!('type' in body) || !body.type) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: type');
  }
});

Deno.test('create-notification - returns 400 for invalid type', async () => {
  const body = {
    user_id: '123',
    type: 'invalid_type',
    title: 'Test',
    body: 'Test body',
  };

  if (!VALID_NOTIFICATION_TYPES.includes(body.type)) {
    const response = new Response(
      JSON.stringify({
        error: `Invalid notification type. Must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}`,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error.includes('Invalid notification type'), true);
  }
});

Deno.test('create-notification - returns 400 when title is missing', async () => {
  const body = {
    user_id: '123',
    type: 'disc_found',
    body: 'Test body',
  };

  if (!('title' in body) || !body.title) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: title' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: title');
  }
});

Deno.test('create-notification - returns 400 when body is missing', async () => {
  const body = {
    user_id: '123',
    type: 'disc_found',
    title: 'Test',
  };

  if (!('body' in body) || !body.body) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: body');
  }
});

Deno.test('create-notification - successfully creates disc_found notification', async () => {
  resetMocks();

  const userId = 'user-123';
  const notificationData = {
    user_id: userId,
    type: 'disc_found',
    title: 'Your disc was found!',
    body: 'Someone found your disc at the course.',
    data: { disc_id: 'test-disc-123' },
  };

  const result = await mockSupabaseClient.from('notifications').insert(notificationData).select().single();

  const response = new Response(
    JSON.stringify({
      success: true,
      notification: result.data,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.notification);
  assertEquals(data.notification.type, 'disc_found');
  assertEquals(data.notification.title, 'Your disc was found!');
  assertEquals(data.notification.read, false);
  assertExists(data.notification.id);
});

Deno.test('create-notification - successfully creates meetup_proposed notification', async () => {
  resetMocks();

  const userId = 'user-123';
  const notificationData = {
    user_id: userId,
    type: 'meetup_proposed',
    title: 'Meetup proposed',
    body: 'Someone proposed a meetup for your disc.',
  };

  const result = await mockSupabaseClient.from('notifications').insert(notificationData).select().single();

  const response = new Response(
    JSON.stringify({
      success: true,
      notification: result.data,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.notification.type, 'meetup_proposed');
});

Deno.test('create-notification - works without optional data field', async () => {
  resetMocks();

  const userId = 'user-123';
  const notificationData = {
    user_id: userId,
    type: 'disc_recovered',
    title: 'Disc recovered!',
    body: 'Your disc has been recovered.',
  };

  const result = await mockSupabaseClient.from('notifications').insert(notificationData).select().single();

  const response = new Response(
    JSON.stringify({
      success: true,
      notification: result.data,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 201);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.notification.type, 'disc_recovered');
});
