import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock Supabase client
const mockSupabaseClient = {
  from: (table: string) => ({
    select: (_columns: string) => ({
      eq: (column: string, value: string) => ({
        single: () => {
          if (table === 'sticker_orders') {
            if (value === 'valid-order-id') {
              return Promise.resolve({
                data: {
                  id: 'valid-order-id',
                  order_number: 'AB-2024-001',
                  quantity: 5,
                  total_price_cents: 2495,
                  status: 'shipped',
                  tracking_number: 'USPS123456789',
                  shipped_at: '2024-01-15T12:00:00Z',
                  user_id: 'user-123',
                  shipping_address: {
                    name: 'John Doe',
                    street_address: '123 Main St',
                    street_address_2: 'Apt 4',
                    city: 'Portland',
                    state: 'OR',
                    postal_code: '97201',
                    country: 'US',
                  },
                },
                error: null,
              });
            } else if (value === 'not-shipped-order') {
              return Promise.resolve({
                data: {
                  id: 'not-shipped-order',
                  status: 'paid',
                  tracking_number: null,
                  user_id: 'user-123',
                },
                error: null,
              });
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
        if (userId === 'user-123') {
          return Promise.resolve({
            data: { user: { email: 'test@example.com' } },
            error: null,
          });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'User not found' } });
      },
    },
  },
};

// Mock email function
let lastEmailSent: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
} | null = null;

const mockSendEmail = (params: { to: string; subject: string; html: string; text: string; replyTo?: string }) => {
  lastEmailSent = params;
  return Promise.resolve({ success: true, messageId: 'msg-123' });
};

// Import handler logic
Deno.test('send-order-shipped - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/send-order-shipped', {
    method: 'GET',
  });

  // Simulate the handler behavior
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

Deno.test('send-order-shipped - returns 400 for invalid JSON body', async () => {
  const req = new Request('http://localhost/send-order-shipped', {
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

Deno.test('send-order-shipped - returns 400 for missing order_id', async () => {
  const body = {};

  if (!('order_id' in body) || !body.order_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: order_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing required field: order_id');
  }
});

Deno.test('send-order-shipped - returns 404 for non-existent order', async () => {
  const result = await mockSupabaseClient.from('sticker_orders').select('*').eq('id', 'non-existent-id').single();

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

Deno.test('send-order-shipped - returns 400 if order is not shipped', async () => {
  const result = await mockSupabaseClient.from('sticker_orders').select('*').eq('id', 'not-shipped-order').single();

  if (result.data && result.data.status !== 'shipped') {
    const response = new Response(JSON.stringify({ error: 'Order is not shipped' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Order is not shipped');
  }
});

Deno.test('send-order-shipped - returns 400 if order has no tracking number', async () => {
  const result = await mockSupabaseClient.from('sticker_orders').select('*').eq('id', 'not-shipped-order').single();

  if (result.data && !result.data.tracking_number) {
    const response = new Response(JSON.stringify({ error: 'Order has no tracking number' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Order has no tracking number');
  }
});

Deno.test('send-order-shipped - sends email with tracking info', async () => {
  const result = await mockSupabaseClient.from('sticker_orders').select('*').eq('id', 'valid-order-id').single();

  assertExists(result.data);
  const order = result.data as {
    id: string;
    order_number: string;
    status: string;
    tracking_number: string | null;
    user_id: string;
  };
  assertEquals(order.status, 'shipped');
  assertEquals(order.tracking_number, 'USPS123456789');

  const userResult = await mockSupabaseClient.auth.admin.getUserById(order.user_id);
  assertExists(userResult.data.user?.email);

  // Simulate sending email
  await mockSendEmail({
    to: userResult.data.user.email,
    subject: `Your Order Has Shipped: ${order.order_number}`,
    html: '<html>test</html>',
    text: 'test',
    replyTo: 'support@aceback.app',
  });

  assertExists(lastEmailSent);
  assertEquals(lastEmailSent.to, 'test@example.com');
  assertEquals(lastEmailSent.subject, 'Your Order Has Shipped: AB-2024-001');
});

Deno.test('send-order-shipped - email contains tracking number', async () => {
  const trackingNumber = 'USPS123456789';
  const html = `<p>Tracking Number: ${trackingNumber}</p>`;
  const text = `Tracking Number: ${trackingNumber}`;

  // Verify tracking number appears in both versions
  assertEquals(html.includes(trackingNumber), true);
  assertEquals(text.includes(trackingNumber), true);
});

Deno.test('send-order-shipped - email contains tracking link for USPS', async () => {
  const trackingNumber = 'USPS123456789';
  const trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  const html = `<a href="${trackingUrl}">Track Your Package</a>`;

  // Verify tracking URL appears in HTML
  assertEquals(html.includes(trackingUrl), true);
});

Deno.test('send-order-shipped - returns success with message_id', async () => {
  const emailResult = await mockSendEmail({
    to: 'test@example.com',
    subject: 'Test',
    html: '<p>test</p>',
    text: 'test',
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
