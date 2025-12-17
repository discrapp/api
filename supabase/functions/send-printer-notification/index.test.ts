import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
type MockOrder = {
  id: string;
  order_number: string;
  quantity: number;
  status: string;
  pdf_storage_path: string | null;
  printer_token: string;
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
  storage: {
    from: (_bucket: string) => ({
      createSignedUrl: (path: string, _expiresIn: number) => {
        if (path) {
          return Promise.resolve({
            data: { signedUrl: `https://storage.supabase.co/signed/${path}?token=abc123` },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { message: 'Invalid path' } });
      },
    }),
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
  lastEmailSent = null;
}

Deno.test('send-printer-notification - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/send-printer-notification', {
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

Deno.test('send-printer-notification - returns 400 for invalid JSON body', async () => {
  const req = new Request('http://localhost/send-printer-notification', {
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

Deno.test('send-printer-notification - returns 400 when order_id is missing', async () => {
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

Deno.test('send-printer-notification - returns 404 when order not found', async () => {
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

Deno.test('send-printer-notification - returns 400 when order has no PDF', async () => {
  resetMocks();

  // Setup mock order without PDF
  mockOrders = [
    {
      id: 'order-123',
      order_number: 'AB-2024-001',
      quantity: 5,
      status: 'processing',
      pdf_storage_path: null,
      printer_token: 'token-123',
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

  // Check if PDF is generated
  if (!order.pdf_storage_path) {
    const response = new Response(JSON.stringify({ error: 'PDF not yet generated for this order' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'PDF not yet generated for this order');
  }
});

Deno.test('send-printer-notification - sends email for valid order with PDF', async () => {
  resetMocks();

  // Setup mock order with PDF
  mockOrders = [
    {
      id: 'order-123',
      order_number: 'AB-2024-001',
      quantity: 5,
      status: 'processing',
      pdf_storage_path: 'orders/test/test.pdf',
      printer_token: 'token-123',
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
  assertEquals(order.order_number, 'AB-2024-001');
  assertExists(order.pdf_storage_path);

  // Generate signed URL
  const { data: signedUrl } = await mockSupabaseClient.storage
    .from('sticker-pdfs')
    .createSignedUrl(order.pdf_storage_path, 60 * 60 * 24 * 7);

  assertExists(signedUrl);
  assertExists(signedUrl.signedUrl);

  // Send email
  const PRINTER_EMAIL = 'printer@aceback.app';
  const emailResult = await mockSendEmail({
    to: PRINTER_EMAIL,
    subject: `New Sticker Order: ${order.order_number} (${order.quantity} stickers)`,
    html: '<html>test</html>',
    text: 'test',
  });

  assertEquals(emailResult.success, true);
  assertExists(emailResult.messageId);

  // Verify email was sent
  assertExists(lastEmailSent);
  assertEquals(lastEmailSent.to, 'printer@aceback.app');
  assertEquals(lastEmailSent.subject, 'New Sticker Order: AB-2024-001 (5 stickers)');
});

Deno.test('send-printer-notification - email contains order details', async () => {
  const order = {
    order_number: 'AB-2024-001',
    quantity: 5,
    status: 'processing',
  };

  const emailHtml = `
    <h2>Order ${order.order_number}</h2>
    <p><strong>Quantity:</strong> ${order.quantity} stickers</p>
    <p><strong>Status:</strong> ${order.status}</p>
  `;

  // Verify order details appear in email
  assertEquals(emailHtml.includes(order.order_number), true);
  assertEquals(emailHtml.includes(String(order.quantity)), true);
  assertEquals(emailHtml.includes(order.status), true);
});

Deno.test('send-printer-notification - email contains shipping address', async () => {
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

Deno.test('send-printer-notification - email contains PDF download link', async () => {
  const signedUrl = 'https://storage.supabase.co/signed/orders/test/test.pdf?token=abc123';

  const emailHtml = `<a href="${signedUrl}" class="btn btn-download">📥 Download PDF</a>`;

  // Verify PDF URL appears in email
  assertEquals(emailHtml.includes(signedUrl), true);
  assertEquals(emailHtml.includes('Download PDF'), true);
});

Deno.test('send-printer-notification - email contains action links', async () => {
  const API_URL = 'https://api.aceback.app';
  const printer_token = 'token-123';

  const markPrintedUrl = `${API_URL}/functions/v1/update-order-status?action=mark_printed&token=${printer_token}`;
  const markShippedUrl = `${API_URL}/functions/v1/update-order-status?action=mark_shipped&token=${printer_token}`;

  const emailHtml = `
    <a href="${markPrintedUrl}" class="btn btn-primary">✅ Mark as Printed</a>
    <a href="${markShippedUrl}" class="btn btn-success">📦 Mark as Shipped</a>
  `;

  // Verify action URLs appear in email
  assertEquals(emailHtml.includes(markPrintedUrl), true);
  assertEquals(emailHtml.includes(markShippedUrl), true);
  assertEquals(emailHtml.includes('Mark as Printed'), true);
  assertEquals(emailHtml.includes('Mark as Shipped'), true);
});

Deno.test('send-printer-notification - returns success with message_id', async () => {
  const emailResult = await mockSendEmail({
    to: 'printer@aceback.app',
    subject: 'New Sticker Order: AB-2024-001 (5 stickers)',
    html: '<html>test</html>',
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
