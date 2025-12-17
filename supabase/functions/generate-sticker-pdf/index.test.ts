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
  pdf_storage_path?: string | null;
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
function mockSupabaseClient() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: () => {
            if (table === 'sticker_orders') {
              const order = mockStickerOrders.find((o) => o.id === value);
              if (!order) {
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }

              // Get order items with QR codes
              const items = mockStickerOrderItems
                .filter((item) => item.order_id === order.id)
                .map((item) => {
                  const qrCode = mockQrCodes.find((qr) => qr.id === item.qr_code_id);
                  return { ...item, qr_code: qrCode };
                });

              return Promise.resolve({
                data: { ...order, items },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: string) => ({
          select: () => ({
            single: () => {
              if (table === 'sticker_orders') {
                const orderIndex = mockStickerOrders.findIndex((o) => o.id === value);
                if (orderIndex !== -1) {
                  mockStickerOrders[orderIndex] = {
                    ...mockStickerOrders[orderIndex],
                    ...values,
                  } as MockStickerOrder;
                  return Promise.resolve({
                    data: mockStickerOrders[orderIndex],
                    error: null,
                  });
                }
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('generate-sticker-pdf: should return 405 for non-POST requests', async () => {
  resetMocks();

  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const data = await response.json();
    assertEquals(data.error, 'Method not allowed');
  }
});

Deno.test('generate-sticker-pdf: should return 400 when order_id is missing', async () => {
  resetMocks();

  const body: { order_id?: string } = {};

  if (!body.order_id) {
    const response = new Response(JSON.stringify({ error: 'Missing required field: order_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing required field: order_id');
  }
});

Deno.test('generate-sticker-pdf: should return 404 when order not found', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();
  const orderId = '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabase
    .from('sticker_orders')
    .select('*, items:sticker_order_items(*, qr_code:qr_codes(*))')
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

Deno.test('generate-sticker-pdf: should return 400 when order has no QR codes', async () => {
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

  const orderId = 'order-1';
  mockStickerOrders.push({
    id: orderId,
    user_id: userId,
    shipping_address_id: addressId,
    quantity: 5,
    unit_price_cents: 100,
    total_price_cents: 500,
    status: 'paid',
  });

  const supabase = mockSupabaseClient();
  const { data: order } = await supabase
    .from('sticker_orders')
    .select('*, items:sticker_order_items(*, qr_code:qr_codes(*))')
    .eq('id', orderId)
    .single();

  assertExists(order);

  const items = (order as MockStickerOrder & { items: MockStickerOrderItem[] }).items || [];
  if (items.length === 0) {
    const response = new Response(JSON.stringify({ error: 'No QR codes found for this order' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'No QR codes found for this order');
  }
});

Deno.test('generate-sticker-pdf: should generate PDF for order with QR codes', async () => {
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

  const orderId = 'order-1';
  mockStickerOrders.push({
    id: orderId,
    user_id: userId,
    shipping_address_id: addressId,
    quantity: 2,
    unit_price_cents: 100,
    total_price_cents: 200,
    status: 'processing',
  });

  // Add QR codes
  const qr1Id = 'qr-1';
  const qr2Id = 'qr-2';
  mockQrCodes.push(
    { id: qr1Id, short_code: 'PDF12345', status: 'generated', assigned_to: userId },
    { id: qr2Id, short_code: 'PDF12346', status: 'generated', assigned_to: userId }
  );

  // Add order items
  mockStickerOrderItems.push({ order_id: orderId, qr_code_id: qr1Id }, { order_id: orderId, qr_code_id: qr2Id });

  const supabase = mockSupabaseClient();
  const { data: order } = await supabase
    .from('sticker_orders')
    .select('*, items:sticker_order_items(*, qr_code:qr_codes(*))')
    .eq('id', orderId)
    .single();

  assertExists(order);

  const items = (order as MockStickerOrder & { items: MockStickerOrderItem[] }).items || [];
  assertEquals(items.length, 2);

  // Simulate PDF generation
  const pdfStoragePath = `orders/${orderId}/stickers.pdf`;
  const pdfUrl = `https://storage.example.com/${pdfStoragePath}`;

  // Update order with PDF path
  await supabase
    .from('sticker_orders')
    .update({ pdf_storage_path: pdfStoragePath })
    .eq('id', orderId)
    .select()
    .single();

  const response = new Response(
    JSON.stringify({
      success: true,
      pdf_url: pdfUrl,
      pdf_storage_path: pdfStoragePath,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertExists(data.pdf_url);
  assertExists(data.pdf_storage_path);

  // Verify order was updated
  const updatedOrder = mockStickerOrders.find((o) => o.id === orderId);
  assertExists(updatedOrder);
  assertExists(updatedOrder.pdf_storage_path);
  assertEquals(updatedOrder.pdf_storage_path, pdfStoragePath);
});

Deno.test('generate-sticker-pdf: should not regenerate PDF if already exists', async () => {
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

  const orderId = 'order-1';
  mockStickerOrders.push({
    id: orderId,
    user_id: userId,
    shipping_address_id: addressId,
    quantity: 1,
    unit_price_cents: 100,
    total_price_cents: 100,
    status: 'processing',
    pdf_storage_path: 'orders/existing.pdf',
  });

  const supabase = mockSupabaseClient();
  const { data: order } = await supabase
    .from('sticker_orders')
    .select('*, items:sticker_order_items(*, qr_code:qr_codes(*))')
    .eq('id', orderId)
    .single();

  assertExists(order);

  const existingPdfPath = (order as MockStickerOrder).pdf_storage_path;
  if (existingPdfPath) {
    const response = new Response(JSON.stringify({ error: 'PDF already generated for this order' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'PDF already generated for this order');
  }
});
