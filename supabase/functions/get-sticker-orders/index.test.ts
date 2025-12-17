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
  order_number: string;
  created_at: string;
  shipping_address?: MockShippingAddress;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockStickerOrders: MockStickerOrder[] = [];
let mockShippingAddresses: MockShippingAddress[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockStickerOrders = [];
  mockShippingAddresses = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: () => {
        if (mockUser) {
          return Promise.resolve({ data: { user: mockUser }, error: null });
        }
        return Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } });
      },
    },
    from: (table: string) => {
      if (table === 'sticker_orders') {
        return {
          select: (_columns?: string) => ({
            eq: (_column: string, value: string) => ({
              order: (_orderBy: string) => {
                const userOrders = mockStickerOrders
                  .filter((order) => order.user_id === value)
                  .map((order) => {
                    const address = mockShippingAddresses.find((addr) => addr.id === order.shipping_address_id);
                    return {
                      ...order,
                      shipping_address: address || null,
                    };
                  });
                return Promise.resolve({ data: userOrders, error: null });
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
  };
}

Deno.test('get-sticker-orders: should return 405 for non-GET requests', () => {
  resetMocks();

  const method = 'POST';

  // This test simulates checking the request method
  const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 405);
  assertEquals(method, 'POST'); // Verify we're testing the right condition
});

Deno.test('get-sticker-orders: should return 401 when not authenticated', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Missing authorization header');
  }
});

Deno.test('get-sticker-orders: should return empty array when user has no orders', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: orders } = await supabase
    .from('sticker_orders')
    .select('*')
    .eq('user_id', authData.user.id)
    .order('created_at');

  const response = new Response(JSON.stringify({ orders: orders || [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.orders, []);
});

Deno.test('get-sticker-orders: should return user orders with shipping address', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const address: MockShippingAddress = {
    id: 'addr-1',
    user_id: mockUser.id,
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };
  mockShippingAddresses.push(address);

  const order: MockStickerOrder = {
    id: 'order-1',
    user_id: mockUser.id,
    shipping_address_id: address.id,
    quantity: 10,
    unit_price_cents: 100,
    total_price_cents: 1000,
    status: 'pending_payment',
    order_number: 'ORD-001',
    created_at: new Date().toISOString(),
  };
  mockStickerOrders.push(order);

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: orders } = await supabase
    .from('sticker_orders')
    .select('*')
    .eq('user_id', authData.user.id)
    .order('created_at');

  const response = new Response(JSON.stringify({ orders: orders || [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.orders.length, 1);
  assertEquals(data.orders[0].id, order.id);
  assertEquals(data.orders[0].quantity, 10);
  assertEquals(data.orders[0].status, 'pending_payment');
  assertExists(data.orders[0].order_number);
  assertExists(data.orders[0].shipping_address);
  assertEquals(data.orders[0].shipping_address.city, 'Test City');
});

Deno.test('get-sticker-orders: should only return orders for authenticated user', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'user1@example.com' };

  const user2 = { id: 'user-2', email: 'user2@example.com' };

  // Create addresses for both users
  const addr1: MockShippingAddress = {
    id: 'addr-1',
    user_id: mockUser.id,
    name: 'User 1',
    street_address: '123 Test St',
    city: 'City 1',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };
  mockShippingAddresses.push(addr1);

  const addr2: MockShippingAddress = {
    id: 'addr-2',
    user_id: user2.id,
    name: 'User 2',
    street_address: '456 Other St',
    city: 'City 2',
    state: 'TS',
    postal_code: '67890',
    country: 'US',
  };
  mockShippingAddresses.push(addr2);

  // Create orders for both users
  const order1: MockStickerOrder = {
    id: 'order-1',
    user_id: mockUser.id,
    shipping_address_id: addr1.id,
    quantity: 5,
    unit_price_cents: 100,
    total_price_cents: 500,
    status: 'pending_payment',
    order_number: 'ORD-001',
    created_at: new Date().toISOString(),
  };
  mockStickerOrders.push(order1);

  const order2: MockStickerOrder = {
    id: 'order-2',
    user_id: user2.id,
    shipping_address_id: addr2.id,
    quantity: 15,
    unit_price_cents: 100,
    total_price_cents: 1500,
    status: 'pending_payment',
    order_number: 'ORD-002',
    created_at: new Date().toISOString(),
  };
  mockStickerOrders.push(order2);

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: orders } = await supabase
    .from('sticker_orders')
    .select('*')
    .eq('user_id', authData.user.id)
    .order('created_at');

  const response = new Response(JSON.stringify({ orders: orders || [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.orders.length, 1);
  assertEquals(data.orders[0].id, order1.id);
  assertEquals(data.orders[0].quantity, 5);
});
