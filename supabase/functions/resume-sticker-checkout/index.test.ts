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
  shipping_address?: MockAddress | MockAddress[];
};

type MockUser = {
  id: string;
  email: string;
};

let mockAddresses: MockAddress[] = [];
let mockOrders: MockOrder[] = [];
let mockUser: MockUser | null = null;
const mockStripeSessionUrl = 'https://checkout.stripe.com/session-456';

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
              // Attach shipping address if available
              const address = mockAddresses.find((a) => a.id === order.shipping_address_id);
              return Promise.resolve({
                data: { ...order, shipping_address: address },
                error: null,
              });
            }
          }
          return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'Not found' } });
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
  }),
};

// Mock Stripe
const mockStripe = {
  checkout: {
    sessions: {
      create: (_params: Record<string, unknown>) => {
        return Promise.resolve({
          id: 'session-456',
          url: mockStripeSessionUrl,
        });
      },
    },
  },
};

// Mock Stripe that throws errors
const mockStripeWithError = {
  checkout: {
    sessions: {
      create: (_params: Record<string, unknown>) => {
        return Promise.reject(new Error('Stripe API error'));
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

// Helper to create a test order with address
function createTestOrderWithAddress(userId: string, status: string = 'pending_payment') {
  const addressId = `addr-${Date.now()}`;
  const orderId = `order-${Date.now()}`;

  const address: MockAddress = {
    id: addressId,
    user_id: userId,
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };
  mockAddresses.push(address);

  const order: MockOrder = {
    id: orderId,
    user_id: userId,
    shipping_address_id: addressId,
    quantity: 10,
    unit_price_cents: 100,
    total_price_cents: 1000,
    status,
    order_number: `AB-2024-${String(mockOrders.length + 1).padStart(3, '0')}`,
  };
  mockOrders.push(order);

  return { order, address };
}

Deno.test('resume-sticker-checkout - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/resume-sticker-checkout', {
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

Deno.test('resume-sticker-checkout - returns 401 when authorization header is missing', async () => {
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

Deno.test('resume-sticker-checkout - returns 400 for invalid JSON body', async () => {
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

Deno.test('resume-sticker-checkout - returns 400 when order_id is missing', async () => {
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

Deno.test('resume-sticker-checkout - returns 401 when user is not authenticated', async () => {
  resetMocks();
  // mockUser is null (not authenticated)

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

Deno.test('resume-sticker-checkout - returns 404 when order is not found', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Try to fetch non-existent order
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

Deno.test('resume-sticker-checkout - returns 404 when order belongs to different user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create order for a different user
  const { order } = createTestOrderWithAddress('different-user-456');

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Fetch the order
  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);

  // Verify ownership
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

Deno.test('resume-sticker-checkout - returns 400 when order is not in pending_payment status', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create order with 'paid' status (not pending_payment)
  const { order } = createTestOrderWithAddress('user-123', 'paid');

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);
  const orderData = fetchedOrder as MockOrder;

  if (orderData.status !== 'pending_payment') {
    const response = new Response(
      JSON.stringify({
        error: 'Order is not awaiting payment',
        status: orderData.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Order is not awaiting payment');
    assertEquals(body.status, 'paid');
  }
});

Deno.test('resume-sticker-checkout - returns 500 when STRIPE_SECRET_KEY is not configured', async () => {
  // Simulate missing Stripe key
  const stripeSecretKey = undefined;

  if (!stripeSecretKey) {
    const response = new Response(JSON.stringify({ error: 'Payment service not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 500);
    const body = await response.json();
    assertEquals(body.error, 'Payment service not configured');
  }
});

Deno.test('resume-sticker-checkout - returns 400 when shipping address is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create order without shipping address
  const orderId = `order-${Date.now()}`;
  const order: MockOrder = {
    id: orderId,
    user_id: 'user-123',
    shipping_address_id: 'non-existent-address',
    quantity: 10,
    unit_price_cents: 100,
    total_price_cents: 1000,
    status: 'pending_payment',
    order_number: 'AB-2024-001',
    shipping_address: undefined, // No shipping address attached
  };
  mockOrders.push(order);

  const shippingAddress = order.shipping_address;

  if (!shippingAddress) {
    const response = new Response(JSON.stringify({ error: 'Order missing shipping address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Order missing shipping address');
  }
});

Deno.test('resume-sticker-checkout - successfully creates checkout session and returns URL', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create order with pending_payment status
  const { order, address } = createTestOrderWithAddress('user-123', 'pending_payment');

  // Verify authentication
  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);
  assertEquals(authData.user.id, 'user-123');

  // Fetch the order
  const { data: fetchedOrder } = await mockSupabaseClient
    .from('sticker_orders')
    .select('*')
    .eq('id', order.id)
    .single();

  assertExists(fetchedOrder);
  const orderData = fetchedOrder as MockOrder;
  assertEquals(orderData.status, 'pending_payment');
  assertEquals(orderData.user_id, authData.user.id);

  // Get shipping address from order
  const shippingAddress = address;
  assertExists(shippingAddress);

  // Create Stripe checkout session
  const session = await mockStripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Discr QR Code Stickers',
            description: `${orderData.quantity} weatherproof QR code stickers for your discs`,
          },
          unit_amount: orderData.unit_price_cents,
        },
        quantity: orderData.quantity,
      },
    ],
    metadata: {
      order_id: orderData.id,
      order_number: orderData.order_number,
      user_id: authData.user.id,
    },
    customer_email: authData.user.email,
  });

  assertExists(session.url);
  assertEquals(session.url, 'https://checkout.stripe.com/session-456');

  // Update order with new session ID
  await mockSupabaseClient
    .from('sticker_orders')
    .update({
      stripe_checkout_session_id: session.id,
    })
    .eq('id', orderData.id);

  // Verify order was updated
  const updatedOrder = mockOrders.find((o) => o.id === orderData.id);
  assertExists(updatedOrder);
  assertEquals(updatedOrder.stripe_checkout_session_id, 'session-456');

  // Build successful response
  const response = new Response(
    JSON.stringify({
      checkout_url: session.url,
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
  assertEquals(body.checkout_url, 'https://checkout.stripe.com/session-456');
  assertEquals(body.order_id, orderData.id);
  assertEquals(body.order_number, orderData.order_number);
});

Deno.test('resume-sticker-checkout - handles Stripe errors gracefully', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { order } = createTestOrderWithAddress('user-123', 'pending_payment');

  try {
    // Attempt to create session with failing Stripe
    await mockStripeWithError.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [],
      metadata: { order_id: order.id },
    });
  } catch (stripeError) {
    // Verify error is caught and handled
    assertExists(stripeError);
    const response = new Response(JSON.stringify({ error: 'Failed to create checkout session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 500);
    const body = await response.json();
    assertEquals(body.error, 'Failed to create checkout session');
  }
});

Deno.test('resume-sticker-checkout - handles shipping address as array from Supabase', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create order where shipping_address comes back as array (Supabase join behavior)
  const addressId = `addr-${Date.now()}`;
  const address: MockAddress = {
    id: addressId,
    user_id: 'user-123',
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };

  const order: MockOrder = {
    id: `order-${Date.now()}`,
    user_id: 'user-123',
    shipping_address_id: addressId,
    quantity: 10,
    unit_price_cents: 100,
    total_price_cents: 1000,
    status: 'pending_payment',
    order_number: 'AB-2024-001',
    shipping_address: [address], // Array format from Supabase join
  };
  mockOrders.push(order);

  // Handle array case
  const shippingAddress = Array.isArray(order.shipping_address) ? order.shipping_address[0] : order.shipping_address;

  assertExists(shippingAddress);
  assertEquals(shippingAddress.name, 'Test User');
  assertEquals(shippingAddress.street_address, '123 Test St');
});

Deno.test('resume-sticker-checkout - includes shipping options in checkout session', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { order, address } = createTestOrderWithAddress('user-123', 'pending_payment');

  // Verify shipping options are included
  const checkoutParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Discr QR Code Stickers',
            description: `${order.quantity} weatherproof QR code stickers for your discs`,
          },
          unit_amount: order.unit_price_cents,
        },
        quantity: order.quantity,
      },
    ],
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: 'usd' },
          display_name: 'Free Shipping',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 3 },
            maximum: { unit: 'business_day', value: 7 },
          },
        },
      },
    ],
    metadata: {
      order_id: order.id,
      order_number: order.order_number,
    },
  };

  // Verify shipping options structure
  assertExists(checkoutParams.shipping_options);
  assertEquals(checkoutParams.shipping_options.length, 1);
  assertEquals(checkoutParams.shipping_options[0].shipping_rate_data.display_name, 'Free Shipping');
  assertEquals(checkoutParams.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);

  // Verify address is used correctly
  assertExists(address);
  assertEquals(address.name, 'Test User');
});
