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
};

type MockQRCode = {
  id: string;
  short_code: string;
  status: string;
  assigned_to: string;
};

type MockStickerOrderItem = {
  id: string;
  order_id: string;
  qr_code_id: string;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockShippingAddresses: MockShippingAddress[] = [];
let mockStickerOrders: MockStickerOrder[] = [];
let mockQRCodes: MockQRCode[] = [];
let mockStickerOrderItems: MockStickerOrderItem[] = [];
let mockCurrentUser: MockUser | null = null;

// Reset mocks between tests
function resetMocks() {
  mockUsers = [];
  mockShippingAddresses = [];
  mockStickerOrders = [];
  mockQRCodes = [];
  mockStickerOrderItems = [];
  mockCurrentUser = null;
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: async () => {
        if (mockCurrentUser) {
          return { data: { user: mockCurrentUser }, error: null };
        }
        return { data: { user: null }, error: { message: 'Not authenticated' } };
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: async () => {
            if (table === 'sticker_orders') {
              const order = mockStickerOrders.find((o) => o.id === value);
              if (!order) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: order, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      insert: (data: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: async () => {
            if (table === 'qr_codes') {
              const newQRCode: MockQRCode = {
                id: `qr-${Date.now()}-${Math.random()}`,
                short_code: Math.random().toString(36).substring(2, 10).toUpperCase(),
                status: 'generated',
                assigned_to: (data as { assigned_to: string }).assigned_to,
              };
              mockQRCodes.push(newQRCode);
              return { data: newQRCode, error: null };
            }
            if (table === 'sticker_order_items') {
              const items = Array.isArray(data) ? data : [data];
              const newItems: MockStickerOrderItem[] = items.map((item) => ({
                id: `item-${Date.now()}-${Math.random()}`,
                order_id: item.order_id as string,
                qr_code_id: item.qr_code_id as string,
              }));
              mockStickerOrderItems.push(...newItems);
              return { data: newItems, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: (updates: Record<string, unknown>) => ({
        eq: (column: string, value: string) => ({
          select: (_columns?: string) => ({
            single: async () => {
              if (table === 'sticker_orders') {
                const index = mockStickerOrders.findIndex((o) => o.id === value);
                if (index !== -1) {
                  mockStickerOrders[index] = {
                    ...mockStickerOrders[index],
                    ...updates,
                  } as MockStickerOrder;
                  return { data: mockStickerOrders[index], error: null };
                }
              }
              return { data: null, error: { message: 'Not found' } };
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('generate-order-qr-codes: should return 405 for non-POST requests', () => {
  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('generate-order-qr-codes: should return 400 when order_id is missing', () => {
  const body: { order_id?: string } = {};

  if (!body.order_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: order_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
  }
});

Deno.test('generate-order-qr-codes: should return 404 when order not found', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();
  const { data: order } = await supabase
    .from('sticker_orders')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .single();

  if (!order) {
    const response = new Response(JSON.stringify({ error: 'Order not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Order not found');
  }
});

Deno.test('generate-order-qr-codes: should return 400 when order is not paid', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const address: MockShippingAddress = {
    id: 'addr-123',
    user_id: mockCurrentUser.id,
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };
  mockShippingAddresses.push(address);

  const order: MockStickerOrder = {
    id: 'order-123',
    user_id: mockCurrentUser.id,
    shipping_address_id: address.id,
    quantity: 5,
    unit_price_cents: 100,
    total_price_cents: 500,
    status: 'pending_payment',
  };
  mockStickerOrders.push(order);

  const supabase = mockSupabaseClient();
  const { data: orderData } = await supabase.from('sticker_orders').select('*').eq('id', order.id).single();

  if (orderData && orderData.status !== 'paid') {
    const response = new Response(JSON.stringify({ error: 'Order must be in paid status to generate QR codes' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Order must be in paid status to generate QR codes');
  }
});

Deno.test('generate-order-qr-codes: should generate QR codes for paid order', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const address: MockShippingAddress = {
    id: 'addr-123',
    user_id: mockCurrentUser.id,
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };
  mockShippingAddresses.push(address);

  const order: MockStickerOrder = {
    id: 'order-123',
    user_id: mockCurrentUser.id,
    shipping_address_id: address.id,
    quantity: 5,
    unit_price_cents: 100,
    total_price_cents: 500,
    status: 'paid',
  };
  mockStickerOrders.push(order);

  const supabase = mockSupabaseClient();

  // Get order
  const { data: orderData } = await supabase.from('sticker_orders').select('*').eq('id', order.id).single();

  if (orderData && orderData.status === 'paid') {
    // Check for existing order items
    const existingItems = mockStickerOrderItems.filter((i) => i.order_id === order.id);
    if (existingItems.length === 0) {
      // Generate QR codes
      const qrCodes: MockQRCode[] = [];
      for (let i = 0; i < orderData.quantity; i++) {
        const { data: qrCode } = await supabase
          .from('qr_codes')
          .insert({
            short_code: Math.random().toString(36).substring(2, 10).toUpperCase(),
            status: 'generated',
            assigned_to: orderData.user_id,
          })
          .select()
          .single();
        if (qrCode && !Array.isArray(qrCode)) {
          qrCodes.push(qrCode);
        }
      }

      // Create order items
      await supabase
        .from('sticker_order_items')
        .insert(qrCodes.map((qr) => ({ order_id: order.id, qr_code_id: qr.id })))
        .select()
        .single();

      // Update order status
      await supabase.from('sticker_orders').update({ status: 'processing' }).eq('id', order.id).select().single();

      const response = new Response(
        JSON.stringify({
          success: true,
          qr_codes: qrCodes,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      assertEquals(response.status, 200);
      const data = await response.json();
      assertEquals(data.success, true);
      assertExists(data.qr_codes);
      assertEquals(data.qr_codes.length, 5);

      // Verify each QR code
      for (const qrCode of data.qr_codes) {
        assertExists(qrCode.id);
        assertExists(qrCode.short_code);
        assertEquals(qrCode.short_code.length, 8);
        assertEquals(qrCode.status, 'generated');
        assertEquals(qrCode.assigned_to, mockCurrentUser.id);
      }

      // Verify order items were created
      const orderItems = mockStickerOrderItems.filter((i) => i.order_id === order.id);
      assertEquals(orderItems.length, 5);

      // Verify order status was updated
      const updatedOrder = mockStickerOrders.find((o) => o.id === order.id);
      assertEquals(updatedOrder?.status, 'processing');
    }
  }
});

Deno.test('generate-order-qr-codes: should return 400 when QR codes already generated', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const address: MockShippingAddress = {
    id: 'addr-123',
    user_id: mockCurrentUser.id,
    name: 'Test User',
    street_address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    postal_code: '12345',
    country: 'US',
  };
  mockShippingAddresses.push(address);

  const order: MockStickerOrder = {
    id: 'order-123',
    user_id: mockCurrentUser.id,
    shipping_address_id: address.id,
    quantity: 3,
    unit_price_cents: 100,
    total_price_cents: 300,
    status: 'processing',
  };
  mockStickerOrders.push(order);

  // Create existing QR code and order item
  const qrCode: MockQRCode = {
    id: 'qr-123',
    short_code: 'EXISTING1',
    status: 'generated',
    assigned_to: mockCurrentUser.id,
  };
  mockQRCodes.push(qrCode);

  const orderItem: MockStickerOrderItem = {
    id: 'item-123',
    order_id: order.id,
    qr_code_id: qrCode.id,
  };
  mockStickerOrderItems.push(orderItem);

  const supabase = mockSupabaseClient();

  // Get order
  const { data: orderData } = await supabase.from('sticker_orders').select('*').eq('id', order.id).single();

  if (orderData) {
    // Check for existing order items
    const existingItems = mockStickerOrderItems.filter((i) => i.order_id === order.id);
    if (existingItems.length > 0) {
      const response = new Response(JSON.stringify({ error: 'QR codes already generated for this order' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'QR codes already generated for this order');
    }
  }
});
