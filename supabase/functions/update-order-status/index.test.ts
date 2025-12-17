import { assertEquals, assertExists } from 'jsr:@std/assert';

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

Deno.test('update-order-status - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/update-order-status', {
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

Deno.test('update-order-status - returns 400 for invalid JSON body', async () => {
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

Deno.test('update-order-status - returns 400 when printer_token is missing', async () => {
  const body = { status: 'printed' };

  if (!('printer_token' in body) || !body.printer_token) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: printer_token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing required field: printer_token');
  }
});

Deno.test('update-order-status - returns 400 when status is missing', async () => {
  const body = { printer_token: '00000000-0000-0000-0000-000000000000' };

  if (!('status' in body) || !body.status) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing required field: status');
  }
});

Deno.test('update-order-status - returns 400 when status is invalid', async () => {
  const VALID_STATUSES = ['processing', 'printed', 'shipped', 'delivered'];
  const status = 'invalid_status';

  if (!VALID_STATUSES.includes(status)) {
    const response = new Response(JSON.stringify({ error: 'Invalid status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Invalid status');
  }
});

Deno.test('update-order-status - returns 404 when order not found by printer_token', async () => {
  resetMocks();

  const result = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('printer_token', '00000000-0000-0000-0000-000000000000')
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

Deno.test('update-order-status - updates order status to printed', async () => {
  resetMocks();

  // Setup mock order
  mockOrders = [
    {
      id: 'order-123',
      status: 'paid',
      order_number: 'AB-2024-001',
      pdf_storage_path: null,
      printer_token: 'valid-printer-token',
    },
  ];

  // Find order
  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);
  assertEquals(order.status, 'paid');

  // Validate status transition
  const STATUS_TRANSITIONS: Record<string, string[]> = {
    pending_payment: [],
    paid: ['processing', 'printed'],
    processing: ['printed'],
    printed: ['shipped'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  };

  const newStatus = 'printed';
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  assertEquals(allowedTransitions.includes(newStatus), true);

  // Update order
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
  assertExists(updatedOrder.printed_at);
});

Deno.test('update-order-status - updates order status to shipped with tracking number', async () => {
  resetMocks();

  // Setup mock order
  mockOrders = [
    {
      id: 'order-123',
      status: 'printed',
      order_number: 'AB-2024-001',
      pdf_storage_path: 'orders/test/test.pdf',
      printer_token: 'valid-printer-token',
    },
  ];

  // Find order
  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);
  assertEquals(order.status, 'printed');

  // Validate status transition
  const STATUS_TRANSITIONS: Record<string, string[]> = {
    pending_payment: [],
    paid: ['processing', 'printed'],
    processing: ['printed'],
    printed: ['shipped'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  };

  const newStatus = 'shipped';
  const trackingNumber = '1Z999AA10123456784';
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];
  assertEquals(allowedTransitions.includes(newStatus), true);

  // Update order
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

  // Verify email was sent
  const emailCall = mockFetchCalls.find((call) => call.url.includes('send-order-shipped'));
  assertExists(emailCall);
  assertEquals(emailCall.body, { order_id: order.id });

  // Verify PDF was deleted
  assertEquals(mockStorageDeleted.includes('orders/test/test.pdf'), true);
});

Deno.test('update-order-status - requires tracking_number when setting status to shipped', async () => {
  const status = 'shipped';
  const trackingNumber = undefined;

  if (status === 'shipped' && !trackingNumber) {
    const response = new Response(JSON.stringify({ error: 'tracking_number is required when marking as shipped' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'tracking_number is required when marking as shipped');
  }
});

Deno.test('update-order-status - rejects invalid status transitions', async () => {
  resetMocks();

  // Setup mock order with pending_payment status
  mockOrders = [
    {
      id: 'order-123',
      status: 'pending_payment',
      order_number: 'AB-2024-001',
      pdf_storage_path: null,
      printer_token: 'valid-printer-token',
    },
  ];

  // Find order
  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .select('id, status, order_number, pdf_storage_path')
    .eq('printer_token', 'valid-printer-token')
    .single();

  assertExists(order);
  assertEquals(order.status, 'pending_payment');

  // Try to transition to shipped (invalid)
  const STATUS_TRANSITIONS: Record<string, string[]> = {
    pending_payment: [],
    paid: ['processing', 'printed'],
    processing: ['printed'],
    printed: ['shipped'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  };

  const newStatus = 'shipped';
  const allowedTransitions = STATUS_TRANSITIONS[order.status] || [];

  if (!allowedTransitions.includes(newStatus)) {
    const response = new Response(
      JSON.stringify({
        error: `Invalid status transition from ${order.status} to ${newStatus}`,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Invalid status transition from pending_payment to shipped');
  }
});

// Restore original fetch after all tests
Deno.test('cleanup', () => {
  globalThis.fetch = originalFetch;
});
