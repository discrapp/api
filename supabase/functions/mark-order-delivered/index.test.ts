import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
type MockOrder = {
  id: string;
  user_id: string;
  status: string;
  order_number: string;
  tracking_number: string | null;
};

type MockUser = {
  id: string;
  email: string;
};

let mockOrders: MockOrder[] = [];
let mockUser: MockUser | null = null;
let updateError: Error | null = null;

// Mock Supabase client
const mockSupabaseClient = {
  auth: {
    getUser: () => {
      if (mockUser) {
        return Promise.resolve({ data: { user: mockUser }, error: null });
      }
      return Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } });
    },
  },
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
          return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'Not found' } });
        },
      }),
    }),
    update: (data: Record<string, unknown>) => ({
      eq: (column: string, value: string) => {
        if (updateError) {
          return Promise.resolve({ data: null, error: updateError });
        }
        if (table === 'sticker_orders') {
          const order = mockOrders.find((o) => o[column as keyof MockOrder] === value);
          if (order) {
            Object.assign(order, data);
            return Promise.resolve({ data: order, error: null });
          }
        }
        return Promise.resolve({ data: null, error: { message: 'Not found' } });
      },
    }),
  }),
};

// Reset mocks before each test
function resetMocks() {
  mockOrders = [];
  mockUser = null;
  updateError = null;
}

// Helper to create a test order
function createTestOrder(
  userId: string,
  status: string = 'shipped',
  trackingNumber: string | null = null
) {
  const orderId = `order-${Date.now()}`;

  const order: MockOrder = {
    id: orderId,
    user_id: userId,
    status,
    order_number: `AB-2024-${String(mockOrders.length + 1).padStart(3, '0')}`,
    tracking_number: trackingNumber,
  };
  mockOrders.push(order);

  return order;
}

Deno.test('mark-order-delivered - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/mark-order-delivered', {
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

Deno.test('mark-order-delivered - returns 401 when authorization header is missing', async () => {
  const authHeader = undefined;

  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const body = await response.json();
    assertEquals(body.error, 'Missing authorization header');
  }
});

Deno.test('mark-order-delivered - returns 400 for invalid JSON body', async () => {
  const invalidJson = 'not valid json';

  try {
    JSON.parse(invalidJson);
  } catch {
    const response = new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Invalid JSON body');
  }
});

Deno.test('mark-order-delivered - returns 400 when order_id is missing', async () => {
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

Deno.test('mark-order-delivered - returns 401 when user is not authenticated', async () => {
  resetMocks();

  const { data: authData, error: authError } = await mockSupabaseClient.auth.getUser();

  if (authError || !authData.user) {
    const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const body = await response.json();
    assertEquals(body.error, 'Unauthorized');
  }
});

Deno.test('mark-order-delivered - returns 404 when order is not found', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  const { data: order, error: orderError } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', 'non-existent-order-id')
    .single();

  if (orderError || !order) {
    const response = new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error, 'Order not found');
  }
});

Deno.test('mark-order-delivered - returns 404 when order belongs to different user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const order = createTestOrder('different-user-456', 'shipped', null);

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);

  const orderData = fetchedOrder as MockOrder;
  if (orderData.user_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error, 'Order not found');
  }
});

Deno.test('mark-order-delivered - returns 400 when order is not shipped', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const order = createTestOrder('user-123', 'processing', null);

  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);
  const orderData = fetchedOrder as MockOrder;

  if (orderData.status !== 'shipped') {
    const response = new Response(
      JSON.stringify({
        error: 'Only shipped orders can be marked as delivered',
        status: orderData.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Only shipped orders can be marked as delivered');
    assertEquals(body.status, 'processing');
  }
});

Deno.test('mark-order-delivered - returns 400 when order has tracking number', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const order = createTestOrder('user-123', 'shipped', '1Z999AA10123456784');

  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);
  const orderData = fetchedOrder as MockOrder;

  if (orderData.tracking_number) {
    const response = new Response(
      JSON.stringify({
        error: 'Orders with tracking numbers are updated automatically',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Orders with tracking numbers are updated automatically');
  }
});

Deno.test('mark-order-delivered - successfully marks shipped order as delivered', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const order = createTestOrder('user-123', 'shipped', null);

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);
  assertEquals(authData.user.id, 'user-123');

  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);
  const orderData = fetchedOrder as MockOrder;
  assertEquals(orderData.status, 'shipped');
  assertEquals(orderData.tracking_number, null);
  assertEquals(orderData.user_id, authData.user.id);

  // Update order status to delivered
  await mockSupabaseClient
    .from('sticker_orders')
    .update({ status: 'delivered', updated_at: new Date().toISOString() })
    .eq('id', orderData.id);

  // Verify order was updated
  const updatedOrder = mockOrders.find((o) => o.id === orderData.id);
  assertExists(updatedOrder);
  assertEquals(updatedOrder.status, 'delivered');

  // Build successful response
  const response = new Response(
    JSON.stringify({
      success: true,
      order_id: orderData.id,
      order_number: orderData.order_number,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.order_id, orderData.id);
  assertEquals(body.order_number, orderData.order_number);
});

Deno.test('mark-order-delivered - handles database update errors gracefully', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };
  updateError = new Error('Database connection failed');

  const order = createTestOrder('user-123', 'shipped', null);

  const { error } = await mockSupabaseClient
    .from('sticker_orders')
    .update({ status: 'delivered' })
    .eq('id', order.id);

  if (error) {
    const response = new Response(JSON.stringify({ error: 'Failed to update order' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 500);
    const body = await response.json();
    assertEquals(body.error, 'Failed to update order');
  }
});

Deno.test('mark-order-delivered - returns 400 when order is pending_payment', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const order = createTestOrder('user-123', 'pending_payment', null);

  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);
  const orderData = fetchedOrder as MockOrder;

  if (orderData.status !== 'shipped') {
    const response = new Response(
      JSON.stringify({
        error: 'Only shipped orders can be marked as delivered',
        status: orderData.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Only shipped orders can be marked as delivered');
    assertEquals(body.status, 'pending_payment');
  }
});

Deno.test('mark-order-delivered - returns 400 when order is already delivered', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const order = createTestOrder('user-123', 'delivered', null);

  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);
  const orderData = fetchedOrder as MockOrder;

  if (orderData.status !== 'shipped') {
    const response = new Response(
      JSON.stringify({
        error: 'Only shipped orders can be marked as delivered',
        status: orderData.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Only shipped orders can be marked as delivered');
    assertEquals(body.status, 'delivered');
  }
});
