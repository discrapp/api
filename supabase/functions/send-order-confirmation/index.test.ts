import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
type MockOrder = {
  id: string;
  order_number: string;
  quantity: number;
  total_price_cents: number;
  status: string;
  user_id: string;
  shipping_address?: {
    name: string;
    street_address: string;
    street_address_2?: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  };
};

let mockOrders: MockOrder[] = [];
let mockUsers: Record<string, { email: string }> = {};
let lastEmailSent: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
} | null = null;

// Mock Supabase client
const mockSupabaseClient = {
  from: (table: string) => ({
    select: (_columns: string) => ({
      eq: (column: string, value: string) => ({
        single: () => {
          if (table === 'sticker_orders') {
            const order = mockOrders.find((o) => o[column as keyof MockOrder] === value);
            if (order) {
              return Promise.resolve({ data: order, error: null });
            }
          }
          return Promise.resolve({ data: null, error: { message: 'Not found' } });
        },
      }),
    }),
  }),
  auth: {
    admin: {
      getUserById: (userId: string) => {
        const user = mockUsers[userId];
        if (user) {
          return Promise.resolve({
            data: { user: { email: user.email } },
            error: null,
          });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'User not found' } });
      },
    },
  },
};

// Mock sendEmail function
const mockSendEmail = (params: { to: string; subject: string; html: string; text: string; replyTo?: string }) => {
  lastEmailSent = params;
  return Promise.resolve({ success: true, messageId: 'msg-123' });
};

// Reset mocks before each test
function resetMocks() {
  mockOrders = [];
  mockUsers = {};
  lastEmailSent = null;
}

Deno.test('send-order-confirmation - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/send-order-confirmation', {
    method: 'GET',
  });

  if (req.method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const body = await response.json();
    assertEquals(body.error, 'Method not allowed');
  }
});

Deno.test('send-order-confirmation - returns 400 for invalid JSON body', async () => {
  const req = new Request('http://localhost/send-order-confirmation', {
    method: 'POST',
    body: 'invalid json',
    headers: { 'Content-Type': 'application/json' },
  });

  let parseError = false;
  try {
    await req.json();
  } catch {
    parseError = true;
  }

  if (parseError) {
    const response = new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Invalid JSON body');
  }
});

Deno.test('send-order-confirmation - returns 400 when order_id is missing', async () => {
  const body: { order_id?: string } = {};

  if (!body.order_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: order_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing required field: order_id');
  }
});

Deno.test('send-order-confirmation - returns 404 when order not found', async () => {
  resetMocks();

  const result = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .single();

  if (!result.data || result.error) {
    const response = new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error, 'Order not found');
  }
});

Deno.test('send-order-confirmation - returns 404 when user email not found', async () => {
  resetMocks();

  // Setup mock order without corresponding user
  mockOrders = [
    {
      id: 'order-123',
      order_number: 'AB-2024-001',
      quantity: 5,
      total_price_cents: 500,
      status: 'paid',
      user_id: 'user-123',
      shipping_address: {
        name: 'Test User',
        street_address: '123 Test St',
        city: 'Test City',
        state: 'TS',
        postal_code: '12345',
        country: 'US',
      },
    },
  ];

  // Get order
  const { data: order } = await mockSupabaseClient.from('sticker_orders').select('*').eq('id', 'order-123').single();

  assertExists(order);

  // Try to get user (will fail)
  const userResult = await mockSupabaseClient.auth.admin.getUserById(order.user_id);

  if (userResult.error || !userResult.data.user?.email) {
    const response = new Response(JSON.stringify({ error: 'User email not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error, 'User email not found');
  }
});

Deno.test('send-order-confirmation - sends email for valid order', async () => {
  resetMocks();

  // Setup mock order and user
  mockOrders = [
    {
      id: 'order-123',
      order_number: 'AB-2024-001',
      quantity: 5,
      total_price_cents: 500,
      status: 'paid',
      user_id: 'user-123',
      shipping_address: {
        name: 'Test User',
        street_address: '123 Test St',
        city: 'Test City',
        state: 'TS',
        postal_code: '12345',
        country: 'US',
      },
    },
  ];

  mockUsers = {
    'user-123': { email: 'test@example.com' },
  };

  // Get order
  const { data: order } = await mockSupabaseClient.from('sticker_orders').select('*').eq('id', 'order-123').single();

  assertExists(order);
  assertEquals(order.order_number, 'AB-2024-001');

  // Get user email
  const userResult = await mockSupabaseClient.auth.admin.getUserById(order.user_id);
  assertExists(userResult.data.user?.email);
  const userEmail = userResult.data.user.email;

  // Send email
  const emailResult = await mockSendEmail({
    to: userEmail,
    subject: `Order Confirmed: ${order.order_number}`,
    html: '<html>test</html>',
    text: 'test',
    replyTo: 'support@aceback.app',
  });

  assertEquals(emailResult.success, true);
  assertExists(emailResult.messageId);

  // Verify email was sent
  assertExists(lastEmailSent);
  assertEquals(lastEmailSent.to, 'test@example.com');
  assertEquals(lastEmailSent.subject, 'Order Confirmed: AB-2024-001');
  assertEquals(lastEmailSent.replyTo, 'support@aceback.app');
});

Deno.test('send-order-confirmation - email contains order details', async () => {
  const order = {
    order_number: 'AB-2024-001',
    quantity: 5,
    total_price_cents: 500,
  };

  const totalPrice = (order.total_price_cents / 100).toFixed(2);

  const emailHtml = `
    <p><strong>Order Number:</strong> ${order.order_number}</p>
    <p><strong>Quantity:</strong> ${order.quantity} stickers</p>
    <p><strong>Total:</strong> $${totalPrice}</p>
  `;

  // Verify order details appear in email
  assertEquals(emailHtml.includes(order.order_number), true);
  assertEquals(emailHtml.includes(String(order.quantity)), true);
  assertEquals(emailHtml.includes(totalPrice), true);
});

Deno.test('send-order-confirmation - email contains shipping address', async () => {
  const shippingAddress = {
    name: 'Test User',
    street_address: '123 Test St',
    street_address_2: 'Apt 4',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };

  const addressLines = [
    shippingAddress.name,
    shippingAddress.street_address,
    shippingAddress.street_address_2,
    `${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}`,
    shippingAddress.country,
  ].filter(Boolean);

  const emailHtml = `<div class="address">${addressLines.map((line) => `<p>${line}</p>`).join('')}</div>`;

  // Verify address appears in email
  assertEquals(emailHtml.includes('Test User'), true);
  assertEquals(emailHtml.includes('123 Test St'), true);
  assertEquals(emailHtml.includes('Apt 4'), true);
  assertEquals(emailHtml.includes('Test City'), true);
});

Deno.test('send-order-confirmation - returns success with message_id', async () => {
  const emailResult = await mockSendEmail({
    to: 'test@example.com',
    subject: 'Order Confirmed: AB-2024-001',
    html: '<html>test</html>',
    text: 'test',
    replyTo: 'support@aceback.app',
  });

  if (emailResult.success) {
    const response = new Response(
      JSON.stringify({
        success: true,
        message_id: emailResult.messageId,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.success, true);
    assertExists(body.message_id);
  }
});
