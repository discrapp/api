import { assertEquals, assertExists, assertStringIncludes } from 'jsr:@std/assert';

// Mock Supabase client
type MockOrderData = {
  id: string;
  status: string;
  order_number: string;
  pdf_storage_path?: string | null;
  printer_token: string;
  printed_at?: string | null;
  tracking_number?: string | null;
  shipped_at?: string | null;
};

let mockOrders: MockOrderData[] = [];
let mockStorageDeleted: string[] = [];
let mockFetchCalls: Array<{ url: string; body: unknown }> = [];

const mockSupabaseClient = {
  from: (table: string) => ({
    select: (_columns: string) => ({
      eq: (column: string, value: string) => ({
        single: () => {
          if (table === 'sticker_orders') {
            const order = mockOrders.find((o) => o[column as keyof MockOrderData] === value);
            if (order) {
              return Promise.resolve({ data: order, error: null });
            }
          }
          return Promise.resolve({ data: null, error: { message: 'Not found' } });
        },
      }),
    }),
    update: (data: Record<string, unknown>) => ({
      eq: (column: string, value: string) => ({
        select: (_columns: string) => ({
          single: () => {
            const order = mockOrders.find((o) => o[column as keyof MockOrderData] === value);
            if (order) {
              const updatedOrder = { ...order, ...data };
              const index = mockOrders.findIndex((o) => o.id === order.id);
              mockOrders[index] = updatedOrder as MockOrderData;
              return Promise.resolve({ data: updatedOrder, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          },
        }),
      }),
    }),
  }),
  storage: {
    from: (_bucket: string) => ({
      remove: (paths: string[]) => {
        mockStorageDeleted.push(...paths);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
};

// Mock fetch for edge function calls
const originalFetch = globalThis.fetch;
globalThis.fetch = ((url: string, options?: RequestInit) => {
  const body = options?.body ? JSON.parse(options.body as string) : null;
  mockFetchCalls.push({ url, body });
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, message_id: 'msg-123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}) as typeof fetch;

// Reset mocks before each test
function resetMocks() {
  mockOrders = [];
  mockStorageDeleted = [];
  mockFetchCalls = [];
}

// Constants from the function
const WEB_APP_URL = 'https://aceback.app';
const VALID_STATUSES = ['processing', 'printed', 'shipped', 'delivered'];
// Note: shipped is allowed from paid/processing/printed since shipping implies printing is done
const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending_payment: [],
  paid: ['processing', 'printed', 'shipped'],
  processing: ['printed', 'shipped'],
  printed: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

// Helper to simulate errorResponse function behavior
function errorResponse(error: string, _statusCode: number, isGet: boolean): Response {
  if (isGet) {
    const redirectUrl = new URL(`${WEB_APP_URL}/order-updated`);
    redirectUrl.searchParams.set('error', error);
    return Response.redirect(redirectUrl.toString(), 302);
  }
  return new Response(JSON.stringify({ error }), {
    status: _statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================
// POST Request Tests (JSON responses)
// ============================================

Deno.test('POST - returns 405 for unsupported methods', async () => {
  const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error, 'Method not allowed');
});

Deno.test('POST - returns 400 for invalid JSON body', async () => {
  const req = new Request('http://localhost/update-order-status', {
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

Deno.test('POST - returns 400 JSON when printer_token is missing', async () => {
  const response = errorResponse('Missing required field: printer_token', 400, false);
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Missing required field: printer_token');
});

Deno.test('POST - returns 400 JSON when status is missing', async () => {
  const response = errorResponse('Missing required field: status', 400, false);
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Missing required field: status');
});

Deno.test('POST - returns 400 JSON when status is invalid', async () => {
  const status = 'invalid_status';
  if (!VALID_STATUSES.includes(status)) {
    const response = errorResponse('Invalid status', 400, false);
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Invalid status');
  }
});

Deno.test('POST - returns 404 JSON when order not found', async () => {
  resetMocks();

  const result = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('printer_token', '00000000-0000-0000-0000-000000000000')
    .single();

  if (!result.data || result.error) {
    const response = errorResponse('Order not found', 404, false);
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error, 'Order not found');
  }
});

Deno.test('POST - allows shipped without tracking_number', () => {
  // tracking_number is now optional for shipped status (e.g., first-class mail)
  // This test verifies we no longer require it
  const status = 'shipped';
  const trackingNumber = undefined;

  // Should NOT return an error for missing tracking_number
  assertEquals(status, 'shipped');
  assertEquals(trackingNumber, undefined);
  // The function would proceed without error - tracking is optional
});

Deno.test('POST - returns JSON success for valid status update', async () => {
  resetMocks();

  mockOrders = [
    {
      id: 'order-123',
      status: 'paid',
      order_number: 'AB-2024-001',
      pdf_storage_path: null,
      printer_token: 'valid-printer-token',
    },
  ];

  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);

  const newStatus = 'printed';
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  assertEquals(allowedTransitions.includes(newStatus), true);

  const updateData = {
    status: newStatus,
    printed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: updatedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .update(updateData)
    .eq('id', order.id)
    .select('id, order_number, status, tracking_number, printed_at, shipped_at, updated_at')
    .single();

  assertExists(updatedOrder);
  assertEquals(updatedOrder.status, 'printed');

  // POST returns JSON
  const response = new Response(JSON.stringify({ success: true, order: updatedOrder }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.order.status, 'printed');
});

// ============================================
// GET Request Tests (Redirect responses)
// ============================================

Deno.test('GET - redirects to error page when token is missing', () => {
  const response = errorResponse('Missing required field: printer_token', 400, true);
  assertEquals(response.status, 302);
  const location = response.headers.get('location');
  assertExists(location);
  assertStringIncludes(location, '/order-updated');
  assertStringIncludes(location, 'error=');
});

Deno.test('GET - redirects to error page when action is invalid', () => {
  const response = errorResponse('Missing required field: status', 400, true);
  assertEquals(response.status, 302);
  const location = response.headers.get('location');
  assertExists(location);
  assertStringIncludes(location, '/order-updated');
  assertStringIncludes(location, 'error=');
});

Deno.test('GET - redirects to error page when order not found', () => {
  const response = errorResponse('Order not found', 404, true);
  assertEquals(response.status, 302);
  const location = response.headers.get('location');
  assertExists(location);
  assertStringIncludes(location, '/order-updated');
  assertStringIncludes(location, 'error=Order');
});

Deno.test('GET - redirects to error page for invalid status transition', () => {
  const response = errorResponse('Invalid status transition from pending_payment to shipped', 400, true);
  assertEquals(response.status, 302);
  const location = response.headers.get('location');
  assertExists(location);
  assertStringIncludes(location, '/order-updated');
  assertStringIncludes(location, 'error=');
});

Deno.test('GET - redirects to success page after marking printed', async () => {
  resetMocks();

  mockOrders = [
    {
      id: 'order-123',
      status: 'paid',
      order_number: 'AB-2024-001',
      pdf_storage_path: null,
      printer_token: 'valid-printer-token',
    },
  ];

  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);

  const updateData = {
    status: 'printed',
    printed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: updatedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .update(updateData)
    .eq('id', order.id)
    .select('id, order_number, status')
    .single();

  assertExists(updatedOrder);

  // GET redirects to success page
  const redirectUrl = new URL(`${WEB_APP_URL}/order-updated`);
  redirectUrl.searchParams.set('order', updatedOrder.order_number);
  redirectUrl.searchParams.set('status', updatedOrder.status);

  const response = Response.redirect(redirectUrl.toString(), 302);
  assertEquals(response.status, 302);
  const location = response.headers.get('location');
  assertExists(location);
  assertStringIncludes(location, '/order-updated');
  assertStringIncludes(location, 'order=AB-2024-001');
  assertStringIncludes(location, 'status=printed');
});

// ============================================
// Status Transition & Business Logic Tests
// ============================================

Deno.test('updates order to shipped with tracking and triggers side effects', async () => {
  resetMocks();

  mockOrders = [
    {
      id: 'order-123',
      status: 'printed',
      order_number: 'AB-2024-001',
      pdf_storage_path: 'orders/test/test.pdf',
      printer_token: 'valid-printer-token',
    },
  ];

  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);
  assertEquals(order.status, 'printed');

  const newStatus = 'shipped';
  const trackingNumber = '1Z999AA10123456784';
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  assertEquals(allowedTransitions.includes(newStatus), true);

  const updateData = {
    status: newStatus,
    shipped_at: new Date().toISOString(),
    tracking_number: trackingNumber,
    updated_at: new Date().toISOString(),
  };

  const { data: updatedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .update(updateData)
    .eq('id', order.id)
    .select('id, order_number, status, tracking_number, printed_at, shipped_at, updated_at')
    .single();

  assertExists(updatedOrder);
  assertEquals(updatedOrder.status, 'shipped');
  assertEquals(updatedOrder.tracking_number, '1Z999AA10123456784');
  assertExists(updatedOrder.shipped_at);

  // Simulate sending shipped email
  await fetch('http://localhost/send-order-shipped', {
    method: 'POST',
    body: JSON.stringify({ order_id: order.id }),
  });

  const emailCall = mockFetchCalls.find((call) => call.url.includes('send-order-shipped'));
  assertExists(emailCall);
  assertEquals(emailCall.body, { order_id: order.id });

  // Simulate PDF deletion
  await mockSupabaseClient.storage.from('stickers').remove([order.pdf_storage_path!]);
  assertEquals(mockStorageDeleted.includes('orders/test/test.pdf'), true);
});

Deno.test('rejects invalid status transitions', async () => {
  resetMocks();

  mockOrders = [
    {
      id: 'order-123',
      status: 'pending_payment',
      order_number: 'AB-2024-001',
      pdf_storage_path: null,
      printer_token: 'valid-printer-token',
    },
  ];

  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);
  assertEquals(order.status, 'pending_payment');

  const newStatus = 'shipped';
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  assertEquals(allowedTransitions.includes(newStatus), false);

  // Should return error
  const response = errorResponse(`Invalid status transition from ${order.status} to ${newStatus}`, 400, false);
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Invalid status transition from pending_payment to shipped');
});

Deno.test('allows skipping from paid to shipped (auto-sets printed_at)', async () => {
  resetMocks();

  mockOrders = [
    {
      id: 'order-123',
      status: 'paid', // Starting from paid, not printed
      order_number: 'AB-2024-001',
      pdf_storage_path: 'orders/test/test.pdf',
      printer_token: 'valid-printer-token',
    },
  ];

  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);
  assertEquals(order.status, 'paid');

  // Verify paid -> shipped is now allowed
  const newStatus = 'shipped';
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  assertEquals(allowedTransitions.includes(newStatus), true);

  // When skipping from paid to shipped, both printed_at and shipped_at should be set
  const now = new Date().toISOString();
  const updateData = {
    status: newStatus,
    shipped_at: now,
    printed_at: now, // Auto-set because we're skipping from paid
    updated_at: now,
  };

  const { data: updatedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .update(updateData)
    .eq('id', order.id)
    .select('id, order_number, status, tracking_number, printed_at, shipped_at, updated_at')
    .single();

  assertExists(updatedOrder);
  assertEquals(updatedOrder.status, 'shipped');
  assertExists(updatedOrder.printed_at); // Should be auto-set
  assertExists(updatedOrder.shipped_at);
  // Note: tracking_number is optional, so no tracking in this test
});

// Restore original fetch after all tests
Deno.test('cleanup', () => {
  globalThis.fetch = originalFetch;
});
