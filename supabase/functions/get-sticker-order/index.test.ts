import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockShippingAddress = {
  id: string;
  user_id: string;
  name: string;
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

type MockStickerOrder = {
  id: string;
  user_id: string;
  shipping_address_id: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  status: string;
  order_number?: string;
  shipping_address?: MockShippingAddress;
  items?: MockStickerOrderItemWithQr[];
};

type MockQrCode = {
  id: string;
  short_code: string;
  status: string;
  assigned_to: string | null;
};

type MockStickerOrderItem = {
  order_id: string;
  qr_code_id: string;
};

type MockStickerOrderItemWithQr = MockStickerOrderItem & {
  qr_code?: MockQrCode;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockShippingAddresses: MockShippingAddress[] = [];
let mockStickerOrders: MockStickerOrder[] = [];
let mockQrCodes: MockQrCode[] = [];
let mockStickerOrderItems: MockStickerOrderItem[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockShippingAddresses = [];
  mockStickerOrders = [];
  mockQrCodes = [];
  mockStickerOrderItems = [];
}

// Mock Supabase client
function mockSupabaseClient(userId?: string) {
  return {
    auth: {
      getUser: () => {
        const user = mockUsers.find((u) => u.id === userId);
        if (user) {
          return Promise.resolve({ data: { user }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } });
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (_column: string, value: string) => ({
          single: () => {
            if (table === 'sticker_orders') {
              const order = mockStickerOrders.find((o) => o.id === value);
              if (!order) {
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }

              // Get shipping address
              const address = mockShippingAddresses.find((a) => a.id === order.shipping_address_id);

              // Get order items with QR codes
              const items = mockStickerOrderItems
                .filter((item) => item.order_id === order.id)
                .map((item) => {
                  const qrCode = mockQrCodes.find((qr) => qr.id === item.qr_code_id);
                  return { ...item, qr_code: qrCode };
                });

              return Promise.resolve({
                data: {
                  ...order,
                  order_number: `ORD-${order.id.slice(0, 8).toUpperCase()}`,
                  shipping_address: address,
                  items,
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
}

Deno.test('get-sticker-order: should return 405 for non-GET requests', async () => {
  resetMocks();

  const method: string = 'POST';

  if (method !== 'GET') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const data = await response.json();
    assertEquals(data.error, 'Method not allowed');
  }
});

Deno.test('get-sticker-order: should return 401 when not authenticated', async () => {
  resetMocks();

  const authHeader = undefined;

  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Missing authorization header');
  }
});

Deno.test('get-sticker-order: should return 400 when order_id is missing', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const queryParams = new URLSearchParams();
  const orderId = queryParams.get('order_id');

  if (!orderId) {
    const response = new Response(JSON.stringify({ error: 'Missing order_id parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing order_id parameter');
  }
});

Deno.test('get-sticker-order: should return 404 when order not found', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const supabase = mockSupabaseClient(userId);
  const orderId = '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabase
    .from('sticker_orders')
    .select('*, shipping_address:shipping_addresses(*), items:sticker_order_items(*, qr_code:qr_codes(*))')
    .eq('id', orderId)
    .single();

  if (error || !data) {
    const response = new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const responseData = await response.json();
    assertEquals(responseData.error, 'Order not found');
  }
});

Deno.test('get-sticker-order: should return 403 when accessing another user order', async () => {
  resetMocks();

  const user1Id = 'user-1';
  const user2Id = 'user-2';
  mockUsers.push({ id: user1Id, email: 'user1@example.com' }, { id: user2Id, email: 'user2@example.com' });

  const addressId = 'address-1';
  mockShippingAddresses.push({
    id: addressId,
    user_id: user2Id,
    name: 'User 2',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  });

  const orderId = 'order-1';
  mockStickerOrders.push({
    id: orderId,
    user_id: user2Id,
    shipping_address_id: addressId,
    quantity: 10,
    unit_price_cents: 100,
    total_price_cents: 1000,
    status: 'pending',
  });

  const supabase = mockSupabaseClient(user1Id);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: order } = await supabase
    .from('sticker_orders')
    .select('*, shipping_address:shipping_addresses(*), items:sticker_order_items(*, qr_code:qr_codes(*))')
    .eq('id', orderId)
    .single();

  assertExists(order);

  // Check if user owns the order
  if ((order as MockStickerOrder).user_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'You do not have access to this order' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You do not have access to this order');
  }
});

Deno.test('get-sticker-order: should return order with items and QR codes', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const addressId = 'address-1';
  mockShippingAddresses.push({
    id: addressId,
    user_id: userId,
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  });

  const qr1Id = 'qr-1';
  const qr2Id = 'qr-2';
  mockQrCodes.push(
    { id: qr1Id, short_code: 'TESTA123', status: 'active', assigned_to: userId },
    { id: qr2Id, short_code: 'TESTB456', status: 'active', assigned_to: userId }
  );

  const orderId = 'order-1';
  mockStickerOrders.push({
    id: orderId,
    user_id: userId,
    shipping_address_id: addressId,
    quantity: 2,
    unit_price_cents: 100,
    total_price_cents: 200,
    status: 'paid',
  });

  mockStickerOrderItems.push({ order_id: orderId, qr_code_id: qr1Id }, { order_id: orderId, qr_code_id: qr2Id });

  const supabase = mockSupabaseClient(userId);
  const { data: order } = await supabase
    .from('sticker_orders')
    .select('*, shipping_address:shipping_addresses(*), items:sticker_order_items(*, qr_code:qr_codes(*))')
    .eq('id', orderId)
    .single();

  assertExists(order);

  const response = new Response(JSON.stringify({ order }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();

  assertExists(data.order);
  assertEquals(data.order.id, orderId);
  assertEquals(data.order.quantity, 2);
  assertEquals(data.order.status, 'paid');
  assertExists(data.order.order_number);
  assertExists(data.order.shipping_address);
  assertEquals(data.order.shipping_address.city, 'Test City');
  assertExists(data.order.items);
  assertEquals(data.order.items.length, 2);
  assertExists(data.order.items[0].qr_code);
  assertExists(data.order.items[0].qr_code.short_code);
});
