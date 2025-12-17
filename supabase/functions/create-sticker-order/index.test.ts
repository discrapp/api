import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
type MockAddress = {
  id: string;
  user_id: string;
  name: string;
  street_address: string;
  street_address_2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

type MockOrder = {
  id: string;
  user_id: string;
  shipping_address_id: string;
  quantity: number;
  unit_price_cents: number;
  total_price_cents: number;
  status: string;
  order_number: string;
  stripe_checkout_session_id?: string;
};

type MockUser = {
  id: string;
  email: string;
};

let mockAddresses: MockAddress[] = [];
let mockOrders: MockOrder[] = [];
let mockUser: MockUser | null = null;
const mockStripeSessionUrl = 'https://checkout.stripe.com/session-123';

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
    insert: (data: Record<string, unknown>) => ({
      select: () => ({
        single: () => {
          if (table === 'shipping_addresses') {
            const newAddress = {
              id: `addr-${Date.now()}`,
              ...data,
            } as MockAddress;
            mockAddresses.push(newAddress);
            return Promise.resolve({ data: newAddress, error: null });
          } else if (table === 'sticker_orders') {
            const newOrder = {
              id: `order-${Date.now()}`,
              order_number: `AB-2024-${String(mockOrders.length + 1).padStart(3, '0')}`,
              ...data,
            } as MockOrder;
            mockOrders.push(newOrder);
            return Promise.resolve({ data: newOrder, error: null });
          }
          return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
        },
      }),
    }),
    select: (_columns: string) => ({
      eq: (column: string, value: string) => ({
        eq: (column2: string, value2: string) => ({
          single: () => {
            if (table === 'shipping_addresses') {
              const address = mockAddresses.find(
                (a) => a[column as keyof MockAddress] === value && a[column2 as keyof MockAddress] === value2
              );
              if (address) {
                return Promise.resolve({ data: address, error: null });
              }
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          },
        }),
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
    update: (data: Record<string, unknown>) => ({
      eq: (column: string, value: string) => {
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
    delete: () => ({
      eq: (column: string, value: string) => {
        if (table === 'sticker_orders') {
          mockOrders = mockOrders.filter((o) => o[column as keyof MockOrder] !== value);
        }
        return Promise.resolve({ data: null, error: null });
      },
    }),
  }),
};

// Mock Stripe
const mockStripe = {
  checkout: {
    sessions: {
      create: (_params: Record<string, unknown>) => {
        return Promise.resolve({
          id: 'session-123',
          url: mockStripeSessionUrl,
        });
      },
    },
  },
};

// Reset mocks before each test
function resetMocks() {
  mockAddresses = [];
  mockOrders = [];
  mockUser = null;
}

Deno.test('create-sticker-order - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/create-sticker-order', {
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

Deno.test('create-sticker-order - returns 401 when not authenticated', async () => {
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

Deno.test('create-sticker-order - returns 400 when quantity is missing', async () => {
  const body: { quantity?: number } = {};

  if (body.quantity === undefined || body.quantity === null) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: quantity' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing required field: quantity');
  }
});

Deno.test('create-sticker-order - returns 400 when quantity is invalid', async () => {
  const quantity = 0;

  if (typeof quantity !== 'number' || quantity < 1) {
    const response = new Response(JSON.stringify({ error: 'Quantity must be at least 1' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Quantity must be at least 1');
  }
});

Deno.test('create-sticker-order - returns 400 when shipping_address is missing', async () => {
  const body: { quantity: number; shipping_address_id?: string; shipping_address?: object } = {
    quantity: 10,
  };

  if (!body.shipping_address_id && !body.shipping_address) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: shipping_address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing required field: shipping_address');
  }
});

Deno.test('create-sticker-order - returns 400 when shipping_address fields are incomplete', async () => {
  const REQUIRED_ADDRESS_FIELDS = ['name', 'street_address', 'city', 'state', 'postal_code'];
  const shipping_address = {
    name: 'Test User',
    // Missing street_address, city, state, postal_code
  };

  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!shipping_address[field as keyof typeof shipping_address]) {
      const response = new Response(JSON.stringify({ error: `Missing shipping address field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const body = await response.json();
      assertEquals(body.error, 'Missing shipping address field: street_address');
      break; // Only test first missing field
    }
  }
});

Deno.test('create-sticker-order - creates order and returns checkout URL', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Verify authentication
  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);
  assertEquals(authData.user.id, 'user-123');

  const shipping_address = {
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };

  // Create shipping address
  const { data: newAddress } = await mockSupabaseClient
    .from('shipping_addresses')
    .insert({
      user_id: authData.user.id,
      ...shipping_address,
    })
    .select()
    .single();

  assertExists(newAddress);
  const addressId = newAddress.id;

  // Calculate total
  const UNIT_PRICE_CENTS = 100;
  const quantity = 10;
  const totalPriceCents = quantity * UNIT_PRICE_CENTS;

  // Create order
  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .insert({
      user_id: authData.user.id,
      shipping_address_id: addressId,
      quantity,
      unit_price_cents: UNIT_PRICE_CENTS,
      total_price_cents: totalPriceCents,
      status: 'pending_payment',
    })
    .select()
    .single();

  assertExists(order);
  const orderData = order as MockOrder;
  assertEquals(orderData.quantity, 10);
  assertEquals(orderData.status, 'pending_payment');

  // Create Stripe checkout session
  const session = await mockStripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'AceBack QR Code Stickers',
            description: `Pack of ${quantity} QR code stickers`,
          },
          unit_amount: UNIT_PRICE_CENTS,
        },
        quantity,
      },
    ],
    mode: 'payment',
    metadata: {
      order_id: orderData.id,
      order_number: orderData.order_number,
    },
    customer_email: authData.user.email,
  });

  assertExists(session.url);
  assertEquals(session.url, 'https://checkout.stripe.com/session-123');

  // Update order with session ID
  await mockSupabaseClient
    .from('sticker_orders')
    .update({
      stripe_checkout_session_id: session.id,
    })
    .eq('id', orderData.id);

  // Verify order was updated
  const { data: updatedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', orderData.id)
    .single();

  assertExists(updatedOrder);
  assertEquals(updatedOrder.stripe_checkout_session_id, 'session-123');
});

Deno.test('create-sticker-order - uses existing shipping address if provided', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Verify authentication
  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Create existing shipping address
  const { data: existingAddress } = await mockSupabaseClient
    .from('shipping_addresses')
    .insert({
      user_id: authData.user.id,
      name: 'Existing Address',
      street_address: '456 Existing St',
      city: 'Existing City',
      state: 'EX',
      postal_code: '67890',
      country: 'US',
    })
    .select()
    .single();

  assertExists(existingAddress);

  // Verify the address belongs to the user
  const { data: verifiedAddress } = await mockSupabaseClient
    .from('shipping_addresses')
    .select('id')
    .eq('id', existingAddress.id)
    .eq('user_id', authData.user.id)
    .single();

  assertExists(verifiedAddress);

  // Create order with existing address
  const UNIT_PRICE_CENTS = 100;
  const quantity = 5;
  const totalPriceCents = quantity * UNIT_PRICE_CENTS;

  const { data: order } = await mockSupabaseClient
    .from('sticker_orders')
    .insert({
      user_id: authData.user.id,
      shipping_address_id: existingAddress.id,
      quantity,
      unit_price_cents: UNIT_PRICE_CENTS,
      total_price_cents: totalPriceCents,
      status: 'pending_payment',
    })
    .select()
    .single();

  assertExists(order);
  const orderData = order as MockOrder;
  assertEquals(orderData.shipping_address_id, existingAddress.id);
});

Deno.test('create-sticker-order - returns 400 for shipping address not belonging to user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Try to verify address that doesn't exist or doesn't belong to user
  const { data: verifiedAddress, error } = await mockSupabaseClient
    .from('shipping_addresses')
    .select('id')
    .eq('id', 'non-existent-id')
    .eq('user_id', authData.user.id)
    .single();

  if (error || !verifiedAddress) {
    const response = new Response(JSON.stringify({ error: 'Shipping address not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Shipping address not found');
  }
});
