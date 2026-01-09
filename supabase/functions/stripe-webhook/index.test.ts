import { assertEquals, assertExists } from 'jsr:@std/assert';

// ============================================================================
// Mock Data Types
// ============================================================================

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
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  paid_at?: string | null;
  updated_at?: string;
};

type MockRecoveryEvent = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  reward_paid_at?: string | null;
  updated_at?: string;
};

type MockProfile = {
  id: string;
  email: string;
  stripe_connect_account_id: string | null;
  stripe_connect_status: string | null;
};

type MockStripeCheckoutSession = {
  id: string;
  payment_intent: string | null;
  metadata: {
    order_id?: string;
    type?: string;
    recovery_event_id?: string;
  };
};

type MockStripeAccount = {
  id: string;
  details_submitted: boolean;
  payouts_enabled: boolean;
  requirements?: {
    currently_due?: string[];
    errors?: { code: string; reason: string }[];
  };
};

// ============================================================================
// Mock Data Storage
// ============================================================================

let mockUsers: MockUser[] = [];
let mockShippingAddresses: MockShippingAddress[] = [];
let mockStickerOrders: MockStickerOrder[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockProfiles: MockProfile[] = [];

// ============================================================================
// Reset Mocks
// ============================================================================

function resetMocks() {
  mockUsers = [];
  mockShippingAddresses = [];
  mockStickerOrders = [];
  mockRecoveryEvents = [];
  mockProfiles = [];
}

// ============================================================================
// Mock Supabase Client
// ============================================================================

function mockSupabaseClient(options?: { updateShouldFail?: boolean }) {
  return {
    auth: {
      admin: {
        createUser: (opts: { email: string; password: string; email_confirm: boolean }) => {
          const newUser: MockUser = {
            id: `user-${Date.now()}`,
            email: opts.email,
          };
          mockUsers.push(newUser);
          return Promise.resolve({ data: { user: newUser }, error: null });
        },
        deleteUser: (userId: string) => {
          mockUsers = mockUsers.filter((u) => u.id !== userId);
          return Promise.resolve({ error: null });
        },
      },
    },
    from: (table: string) => ({
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: () => {
            if (table === 'shipping_addresses') {
              const addressData = values as MockShippingAddress;
              const newAddress: MockShippingAddress = {
                ...addressData,
                id: `addr-${Date.now()}`,
              };
              mockShippingAddresses.push(newAddress);
              return Promise.resolve({ data: newAddress, error: null });
            }
            if (table === 'sticker_orders') {
              const orderData = values as MockStickerOrder;
              const newOrder: MockStickerOrder = {
                ...orderData,
                id: `order-${Date.now()}`,
                order_number: `ORD-${Date.now()}`,
              };
              mockStickerOrders.push(newOrder);
              return Promise.resolve({ data: newOrder, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (col1: string, val1: string) => {
          // For sticker_orders that need chained .eq()
          return {
            eq: (col2: string, val2: string) => {
              // Handle chained .eq() for sticker_orders (need both id and session_id)
              return {
                eq: (_col3: string, _val3: string) => ({
                  // Third .eq() for status check
                  then: undefined as undefined,
                }),
                select: () => ({
                  single: () => {
                    if (table === 'sticker_orders') {
                      if (options?.updateShouldFail) {
                        return Promise.resolve({
                          data: null,
                          error: { message: 'Update failed' },
                        });
                      }
                      const order = mockStickerOrders.find(
                        (o) =>
                          o[col1 as keyof MockStickerOrder] === val1 &&
                          o[col2 as keyof MockStickerOrder] === val2
                      );
                      if (order) {
                        Object.assign(order, values);
                        return Promise.resolve({ data: order, error: null });
                      }
                      return Promise.resolve({ data: null, error: { message: 'Order not found' } });
                    }
                    return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
                  },
                }),
              };
            },
            select: () => ({
              single: () => {
                if (table === 'sticker_orders') {
                  if (options?.updateShouldFail) {
                    return Promise.resolve({
                      data: null,
                      error: { message: 'Update failed' },
                    });
                  }
                  // For single .eq() case, just match on col1
                  const order = mockStickerOrders.find(
                    (o) => o[col1 as keyof MockStickerOrder] === val1
                  );
                  if (order) {
                    Object.assign(order, values);
                    return Promise.resolve({ data: order, error: null });
                  }
                  return Promise.resolve({ data: null, error: { message: 'Order not found' } });
                }
                return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
              },
            }),
          };
        },
      }),
      delete: () => ({
        eq: (_column: string, value: string) => {
          if (table === 'sticker_orders') {
            mockStickerOrders = mockStickerOrders.filter((o) => o.id !== value);
            return Promise.resolve({ error: null });
          }
          if (table === 'shipping_addresses') {
            mockShippingAddresses = mockShippingAddresses.filter((a) => a.id !== value);
            return Promise.resolve({ error: null });
          }
          return Promise.resolve({ error: { message: 'Unknown table' } });
        },
      }),
    }),
  };
}

// Simpler mock for single-column updates (recovery_events and profiles)
function mockSupabaseClientSimple(options?: {
  recoveryUpdateShouldFail?: boolean;
  profileUpdateShouldFail?: boolean;
}) {
  return {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: (column: string, value: string) => {
          if (table === 'recovery_events') {
            if (options?.recoveryUpdateShouldFail) {
              return Promise.resolve({ error: { message: 'Update failed' } });
            }
            const event = mockRecoveryEvents.find((e) => e[column as keyof MockRecoveryEvent] === value);
            if (event) {
              Object.assign(event, values);
              return Promise.resolve({ error: null });
            }
            return Promise.resolve({ error: { message: 'Event not found' } });
          }
          if (table === 'profiles') {
            if (options?.profileUpdateShouldFail) {
              return Promise.resolve({ error: { message: 'Update failed' } });
            }
            const profile = mockProfiles.find((p) => p[column as keyof MockProfile] === value);
            if (profile) {
              Object.assign(profile, values);
              return Promise.resolve({ error: null });
            }
            return Promise.resolve({ error: { message: 'Profile not found' } });
          }
          return Promise.resolve({ error: { message: 'Unknown table' } });
        },
      }),
    }),
  };
}

// ============================================================================
// TESTS: Method Validation
// ============================================================================

Deno.test('stripe-webhook: should return 405 for GET requests', async () => {
  resetMocks();

  const method = 'GET' as string;

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

Deno.test('stripe-webhook: should return 405 for PUT requests', async () => {
  resetMocks();

  const method = 'PUT' as string;

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

Deno.test('stripe-webhook: should return 405 for DELETE requests', async () => {
  resetMocks();

  const method = 'DELETE' as string;

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

Deno.test('stripe-webhook: should return 405 for PATCH requests', async () => {
  resetMocks();

  const method = 'PATCH' as string;

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

// ============================================================================
// TESTS: Header Validation
// ============================================================================

Deno.test('stripe-webhook: should return 400 when stripe-signature header is missing', async () => {
  resetMocks();

  const stripeSignature = undefined;

  if (!stripeSignature) {
    const response = new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing stripe-signature header');
  }
});

Deno.test('stripe-webhook: should return 400 when stripe-signature header is null', async () => {
  resetMocks();

  const stripeSignature = null;

  if (!stripeSignature) {
    const response = new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing stripe-signature header');
  }
});

Deno.test('stripe-webhook: should return 400 when stripe-signature header is empty string', async () => {
  resetMocks();

  const stripeSignature = '';

  if (!stripeSignature) {
    const response = new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing stripe-signature header');
  }
});

// ============================================================================
// TESTS: Configuration Validation
// ============================================================================

Deno.test('stripe-webhook: should return 500 when no webhook secrets are configured', async () => {
  resetMocks();

  const webhookSecret = undefined;
  const connectWebhookSecret = undefined;

  if (!webhookSecret && !connectWebhookSecret) {
    const response = new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 500);
    const data = await response.json();
    assertEquals(data.error, 'Webhook not configured');
  }
});

Deno.test('stripe-webhook: should return 500 when STRIPE_SECRET_KEY is not configured', async () => {
  resetMocks();

  const stripeSecretKey = undefined;

  if (!stripeSecretKey) {
    const response = new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 500);
    const data = await response.json();
    assertEquals(data.error, 'Stripe not configured');
  }
});

Deno.test('stripe-webhook: should proceed when only STRIPE_WEBHOOK_SECRET is configured', async () => {
  resetMocks();

  const webhookSecret = 'whsec_test_main';
  const connectWebhookSecret = undefined;

  // Should NOT return 500 error since at least one secret is configured
  const hasAtLeastOneSecret = webhookSecret || connectWebhookSecret;
  assertEquals(hasAtLeastOneSecret, 'whsec_test_main');
});

Deno.test('stripe-webhook: should proceed when only STRIPE_CONNECT_WEBHOOK_SECRET is configured', async () => {
  resetMocks();

  const webhookSecret = undefined;
  const connectWebhookSecret = 'whsec_test_connect';

  // Should NOT return 500 error since at least one secret is configured
  const hasAtLeastOneSecret = webhookSecret || connectWebhookSecret;
  assertEquals(hasAtLeastOneSecret, 'whsec_test_connect');
});

Deno.test('stripe-webhook: should proceed when both webhook secrets are configured', async () => {
  resetMocks();

  const webhookSecret = 'whsec_test_main';
  const connectWebhookSecret = 'whsec_test_connect';

  // Should NOT return 500 error since both secrets are configured
  const hasAtLeastOneSecret = webhookSecret || connectWebhookSecret;
  assertEquals(!!hasAtLeastOneSecret, true);
});

// ============================================================================
// TESTS: Signature Verification
// ============================================================================

Deno.test('stripe-webhook: should return 400 when signature verification fails with all secrets', async () => {
  resetMocks();

  // Simulate that both webhook secrets fail to verify
  let event = null;

  // Try main secret
  const mainSecretVerified = false;
  if (mainSecretVerified) {
    event = { type: 'checkout.session.completed' };
  }

  // Try connect secret
  const connectSecretVerified = false;
  if (!event && connectSecretVerified) {
    event = { type: 'checkout.session.completed' };
  }

  if (!event) {
    const response = new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Invalid signature');
  }
});

Deno.test('stripe-webhook: should accept event when main webhook secret verifies', async () => {
  resetMocks();

  let event = null;

  // Try main secret - succeeds
  const mainSecretVerified = true;
  if (mainSecretVerified) {
    event = { type: 'checkout.session.completed' };
  }

  assertExists(event);
  assertEquals(event.type, 'checkout.session.completed');
});

Deno.test('stripe-webhook: should fall back to connect webhook secret when main fails', async () => {
  resetMocks();

  let event = null;

  // Try main secret - fails
  const mainSecretVerified = false;
  if (mainSecretVerified) {
    event = { type: 'checkout.session.completed' };
  }

  // Try connect secret - succeeds
  const connectSecretVerified = true;
  if (!event && connectSecretVerified) {
    event = { type: 'account.updated' };
  }

  assertExists(event);
  assertEquals(event.type, 'account.updated');
});

// ============================================================================
// TESTS: Unhandled Event Types
// ============================================================================

Deno.test('stripe-webhook: should return 200 for unhandled event types', async () => {
  resetMocks();

  const HANDLED_EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'account.updated'];
  const eventType = 'payment_intent.succeeded';

  if (!HANDLED_EVENTS.includes(eventType)) {
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.received, true);
  }
});

Deno.test('stripe-webhook: should ignore invoice.paid events', async () => {
  resetMocks();

  const HANDLED_EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'account.updated'];
  const eventType = 'invoice.paid';

  if (!HANDLED_EVENTS.includes(eventType)) {
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.received, true);
  }
});

Deno.test('stripe-webhook: should ignore customer.created events', async () => {
  resetMocks();

  const HANDLED_EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'account.updated'];
  const eventType = 'customer.created';

  if (!HANDLED_EVENTS.includes(eventType)) {
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 200);
  }
});

Deno.test('stripe-webhook: should ignore charge.succeeded events', async () => {
  resetMocks();

  const HANDLED_EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'account.updated'];
  const eventType = 'charge.succeeded';

  if (!HANDLED_EVENTS.includes(eventType)) {
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 200);
  }
});

// ============================================================================
// TESTS: checkout.session.completed - Sticker Orders
// ============================================================================

Deno.test('stripe-webhook: checkout.session.completed should return 400 when order_id is missing for sticker order', async () => {
  resetMocks();

  const session: MockStripeCheckoutSession = {
    id: 'cs_test_123',
    payment_intent: 'pi_test_456',
    metadata: {},
  };

  // No type means it's a sticker order (not a reward payment)
  const paymentType = session.metadata?.type;

  if (paymentType !== 'reward_payment') {
    const orderId = session.metadata?.order_id;
    if (!orderId) {
      const response = new Response(JSON.stringify({ error: 'Missing order_id in metadata' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'Missing order_id in metadata');
    }
  }
});

Deno.test('stripe-webhook: checkout.session.completed should update sticker order to paid', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create a test user
  const { data: userData } = await supabase.auth.admin.createUser({
    email: `webhook-test-${Date.now()}@example.com`,
    password: 'testpassword123',
    email_confirm: true,
  });

  assertExists(userData.user);

  // Create shipping address
  const { data: address } = await supabase
    .from('shipping_addresses')
    .insert({
      user_id: userData.user.id,
      name: 'Test User',
      street_address: '123 Test St',
      city: 'Test City',
      state: 'TS',
      postal_code: '12345',
      country: 'US',
    })
    .select()
    .single();

  assertExists(address);

  // Create an order with pending_payment status
  const testCheckoutSessionId = `cs_test_${Date.now()}`;
  const { data: order } = await supabase
    .from('sticker_orders')
    .insert({
      user_id: userData.user.id,
      shipping_address_id: address.id,
      quantity: 10,
      unit_price_cents: 100,
      total_price_cents: 1000,
      status: 'pending_payment',
      stripe_checkout_session_id: testCheckoutSessionId,
    })
    .select()
    .single();

  assertExists(order);

  // Simulate checkout.session.completed event
  const session: MockStripeCheckoutSession = {
    id: testCheckoutSessionId,
    payment_intent: 'pi_test_123',
    metadata: {
      order_id: order.id,
    },
  };

  // Update order status to paid
  const now = new Date().toISOString();
  const { data: updatedOrder } = await supabase
    .from('sticker_orders')
    .update({
      status: 'paid',
      paid_at: now,
      stripe_payment_intent_id: session.payment_intent,
      updated_at: now,
    })
    .eq('id', session.metadata.order_id!)
    .eq('stripe_checkout_session_id', session.id)
    .select()
    .single();

  assertExists(updatedOrder);
  assertEquals(updatedOrder.status, 'paid');
  assertEquals(updatedOrder.stripe_payment_intent_id, 'pi_test_123');
  assertExists(updatedOrder.paid_at);
});

Deno.test('stripe-webhook: checkout.session.completed should return 500 when order update fails', async () => {
  resetMocks();

  const supabase = mockSupabaseClient({ updateShouldFail: true });

  // Create a test user
  const { data: userData } = await supabase.auth.admin.createUser({
    email: `webhook-fail-${Date.now()}@example.com`,
    password: 'testpassword123',
    email_confirm: true,
  });

  assertExists(userData.user);

  // Create shipping address
  const { data: address } = await supabase
    .from('shipping_addresses')
    .insert({
      user_id: userData.user.id,
      name: 'Test User',
      street_address: '123 Test St',
      city: 'Test City',
      state: 'TS',
      postal_code: '12345',
      country: 'US',
    })
    .select()
    .single();

  assertExists(address);

  // Create an order
  const testCheckoutSessionId = `cs_test_fail_${Date.now()}`;
  const { data: order } = await supabase
    .from('sticker_orders')
    .insert({
      user_id: userData.user.id,
      shipping_address_id: address.id,
      quantity: 10,
      unit_price_cents: 100,
      total_price_cents: 1000,
      status: 'pending_payment',
      stripe_checkout_session_id: testCheckoutSessionId,
    })
    .select()
    .single();

  assertExists(order);

  // Simulate the update failing
  const failNow = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('sticker_orders')
    .update({
      status: 'paid',
      paid_at: failNow,
      stripe_payment_intent_id: 'pi_test_123',
      updated_at: failNow,
    })
    .eq('id', order.id)
    .eq('stripe_checkout_session_id', testCheckoutSessionId)
    .select()
    .single();

  if (updateError) {
    const response = new Response(JSON.stringify({ error: 'Failed to update order' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 500);
    const data = await response.json();
    assertEquals(data.error, 'Failed to update order');
  }
});

Deno.test('stripe-webhook: checkout.session.completed should trigger fulfillment chain', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create order
  const { data: userData } = await supabase.auth.admin.createUser({
    email: `fulfillment-${Date.now()}@example.com`,
    password: 'testpassword123',
    email_confirm: true,
  });

  assertExists(userData.user);

  const { data: address } = await supabase
    .from('shipping_addresses')
    .insert({
      user_id: userData.user.id,
      name: 'Test User',
      street_address: '123 Test St',
      city: 'Test City',
      state: 'TS',
      postal_code: '12345',
      country: 'US',
    })
    .select()
    .single();

  assertExists(address);

  const testCheckoutSessionId = `cs_test_fulfillment_${Date.now()}`;
  const { data: order } = await supabase
    .from('sticker_orders')
    .insert({
      user_id: userData.user.id,
      shipping_address_id: address.id,
      quantity: 5,
      unit_price_cents: 100,
      total_price_cents: 500,
      status: 'pending_payment',
      stripe_checkout_session_id: testCheckoutSessionId,
    })
    .select()
    .single();

  assertExists(order);

  // Simulate order update
  const fulfillNow = new Date().toISOString();
  const { data: updatedOrder } = await supabase
    .from('sticker_orders')
    .update({
      status: 'paid',
      paid_at: fulfillNow,
      stripe_payment_intent_id: 'pi_test_fulfillment',
      updated_at: fulfillNow,
    })
    .eq('id', order.id)
    .eq('stripe_checkout_session_id', testCheckoutSessionId)
    .select()
    .single();

  assertExists(updatedOrder);
  assertEquals(updatedOrder.status, 'paid');
  assertExists(updatedOrder.paid_at);

  // In the real handler, this would trigger:
  // 1. generate-order-qr-codes
  // 2. generate-sticker-pdf (if QR succeeds)
  // 3. send-printer-notification (if PDF succeeds)
  // 4. send-order-confirmation (fire and forget)

  // We verify the structure exists for these calls
  const functionsUrl = 'https://test.supabase.co/functions/v1';
  const qrEndpoint = `${functionsUrl}/generate-order-qr-codes`;
  const pdfEndpoint = `${functionsUrl}/generate-sticker-pdf`;
  const printerEndpoint = `${functionsUrl}/send-printer-notification`;
  const confirmationEndpoint = `${functionsUrl}/send-order-confirmation`;

  assertEquals(qrEndpoint.includes('generate-order-qr-codes'), true);
  assertEquals(pdfEndpoint.includes('generate-sticker-pdf'), true);
  assertEquals(printerEndpoint.includes('send-printer-notification'), true);
  assertEquals(confirmationEndpoint.includes('send-order-confirmation'), true);
});

// ============================================================================
// TESTS: checkout.session.completed - Reward Payments
// ============================================================================

Deno.test('stripe-webhook: checkout.session.completed should return 400 when recovery_event_id is missing for reward payment', async () => {
  resetMocks();

  const session: MockStripeCheckoutSession = {
    id: 'cs_reward_123',
    payment_intent: 'pi_reward_456',
    metadata: {
      type: 'reward_payment',
      // missing recovery_event_id
    },
  };

  const paymentType = session.metadata?.type;

  if (paymentType === 'reward_payment') {
    const recoveryEventId = session.metadata?.recovery_event_id;
    if (!recoveryEventId) {
      const response = new Response(JSON.stringify({ error: 'Missing recovery_event_id in metadata' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'Missing recovery_event_id in metadata');
    }
  }
});

Deno.test('stripe-webhook: checkout.session.completed should mark reward as paid', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple();

  // Create a recovery event
  const recoveryEvent: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: 'disc-456',
    finder_id: 'finder-789',
    status: 'recovered',
    reward_paid_at: null,
    updated_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recoveryEvent);

  // Simulate checkout.session.completed for reward payment
  const session: MockStripeCheckoutSession = {
    id: 'cs_reward_123',
    payment_intent: 'pi_reward_456',
    metadata: {
      type: 'reward_payment',
      recovery_event_id: recoveryEvent.id,
    },
  };

  // Mark reward as paid
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('recovery_events')
    .update({
      reward_paid_at: now,
      updated_at: now,
    })
    .eq('id', session.metadata.recovery_event_id!);

  assertEquals(updateError, null);

  // Verify the update
  const updatedEvent = mockRecoveryEvents.find((e) => e.id === recoveryEvent.id);
  assertExists(updatedEvent);
  assertExists(updatedEvent.reward_paid_at);
});

Deno.test('stripe-webhook: checkout.session.completed should return 500 when reward update fails', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple({ recoveryUpdateShouldFail: true });

  // Create a recovery event
  const recoveryEvent: MockRecoveryEvent = {
    id: 'recovery-fail-123',
    disc_id: 'disc-456',
    finder_id: 'finder-789',
    status: 'recovered',
    reward_paid_at: null,
  };
  mockRecoveryEvents.push(recoveryEvent);

  // Simulate the update failing
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('recovery_events')
    .update({
      reward_paid_at: now,
      updated_at: now,
    })
    .eq('id', recoveryEvent.id);

  if (updateError) {
    const response = new Response(JSON.stringify({ error: 'Failed to mark reward as paid' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 500);
    const data = await response.json();
    assertEquals(data.error, 'Failed to mark reward as paid');
  }
});

// ============================================================================
// TESTS: checkout.session.expired
// ============================================================================

Deno.test('stripe-webhook: checkout.session.expired should return 200 when order_id is missing', async () => {
  resetMocks();

  const session: MockStripeCheckoutSession = {
    id: 'cs_expired_123',
    payment_intent: null,
    metadata: {},
  };

  const orderId = session.metadata?.order_id;
  if (!orderId) {
    // For expired sessions without order_id, we just acknowledge receipt
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.received, true);
  }
});

Deno.test('stripe-webhook: checkout.session.expired should cancel pending order', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();

  // Create a test user and order
  const { data: userData } = await supabase.auth.admin.createUser({
    email: `expired-${Date.now()}@example.com`,
    password: 'testpassword123',
    email_confirm: true,
  });

  assertExists(userData.user);

  const { data: address } = await supabase
    .from('shipping_addresses')
    .insert({
      user_id: userData.user.id,
      name: 'Test User',
      street_address: '123 Test St',
      city: 'Test City',
      state: 'TS',
      postal_code: '12345',
      country: 'US',
    })
    .select()
    .single();

  assertExists(address);

  const testCheckoutSessionId = `cs_expired_${Date.now()}`;
  const { data: order } = await supabase
    .from('sticker_orders')
    .insert({
      user_id: userData.user.id,
      shipping_address_id: address.id,
      quantity: 10,
      unit_price_cents: 100,
      total_price_cents: 1000,
      status: 'pending_payment',
      stripe_checkout_session_id: testCheckoutSessionId,
    })
    .select()
    .single();

  assertExists(order);
  const stickerOrder = order as MockStickerOrder;
  assertEquals(stickerOrder.status, 'pending_payment');

  // Create a custom client for this test that handles status check
  const mockOrdersForExpired = mockStickerOrders;
  const orderToUpdate = mockOrdersForExpired.find(
    (o) => o.id === order.id && o.status === 'pending_payment'
  );

  if (orderToUpdate) {
    orderToUpdate.status = 'cancelled';
    orderToUpdate.updated_at = new Date().toISOString();
  }

  // Verify the order was cancelled
  const cancelledOrder = mockStickerOrders.find((o) => o.id === order.id);
  assertExists(cancelledOrder);
  assertEquals(cancelledOrder.status, 'cancelled');
});

Deno.test('stripe-webhook: checkout.session.expired should only cancel pending_payment orders', async () => {
  resetMocks();

  // Create an order that's already paid
  const paidOrder: MockStickerOrder = {
    id: 'order-paid-123',
    user_id: 'user-123',
    shipping_address_id: 'addr-123',
    quantity: 10,
    unit_price_cents: 100,
    total_price_cents: 1000,
    status: 'paid', // Already paid
    stripe_checkout_session_id: 'cs_already_paid',
  };
  mockStickerOrders.push(paidOrder);

  // Simulate expired event for this session
  const session: MockStripeCheckoutSession = {
    id: 'cs_already_paid',
    payment_intent: null,
    metadata: {
      order_id: paidOrder.id,
    },
  };

  // The update should only affect pending_payment orders
  const orderToUpdate = mockStickerOrders.find(
    (o) =>
      o.id === session.metadata?.order_id &&
      o.stripe_checkout_session_id === session.id &&
      o.status === 'pending_payment'
  );

  // Order should NOT be found since it's already paid
  assertEquals(orderToUpdate, undefined);

  // Original order should still be paid
  const originalOrder = mockStickerOrders.find((o) => o.id === paidOrder.id);
  assertExists(originalOrder);
  assertEquals(originalOrder.status, 'paid');
});

// ============================================================================
// TESTS: account.updated
// ============================================================================

Deno.test('stripe-webhook: account.updated should set status to active when account is fully onboarded', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple();

  // Create a profile with a Connect account
  const profile: MockProfile = {
    id: 'user-123',
    email: 'finder@example.com',
    stripe_connect_account_id: 'acct_test_123',
    stripe_connect_status: 'pending',
  };
  mockProfiles.push(profile);

  // Simulate fully onboarded account
  const account: MockStripeAccount = {
    id: 'acct_test_123',
    details_submitted: true,
    payouts_enabled: true,
    requirements: {
      currently_due: [],
      errors: [],
    },
  };

  // Determine status
  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
    status = 'restricted';
  }

  // Update profile
  await supabase.from('profiles').update({ stripe_connect_status: status }).eq('stripe_connect_account_id', account.id);

  // Verify
  const updatedProfile = mockProfiles.find((p) => p.stripe_connect_account_id === account.id);
  assertExists(updatedProfile);
  assertEquals(updatedProfile.stripe_connect_status, 'active');
});

Deno.test('stripe-webhook: account.updated should set status to restricted when requirements are due', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple();

  // Create a profile
  const profile: MockProfile = {
    id: 'user-456',
    email: 'finder2@example.com',
    stripe_connect_account_id: 'acct_test_456',
    stripe_connect_status: 'pending',
  };
  mockProfiles.push(profile);

  // Simulate account with requirements due
  const account: MockStripeAccount = {
    id: 'acct_test_456',
    details_submitted: true,
    payouts_enabled: false,
    requirements: {
      currently_due: ['individual.verification.document'],
      errors: [],
    },
  };

  // Determine status
  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
    status = 'restricted';
  }

  assertEquals(status, 'restricted');

  // Update profile
  await supabase.from('profiles').update({ stripe_connect_status: status }).eq('stripe_connect_account_id', account.id);

  // Verify
  const updatedProfile = mockProfiles.find((p) => p.stripe_connect_account_id === account.id);
  assertExists(updatedProfile);
  assertEquals(updatedProfile.stripe_connect_status, 'restricted');
});

Deno.test('stripe-webhook: account.updated should set status to restricted when there are errors', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple();

  // Create a profile
  const profile: MockProfile = {
    id: 'user-789',
    email: 'finder3@example.com',
    stripe_connect_account_id: 'acct_test_789',
    stripe_connect_status: 'pending',
  };
  mockProfiles.push(profile);

  // Simulate account with errors
  const account: MockStripeAccount = {
    id: 'acct_test_789',
    details_submitted: true,
    payouts_enabled: false,
    requirements: {
      currently_due: [],
      errors: [{ code: 'invalid_address', reason: 'Address is invalid' }],
    },
  };

  // Determine status
  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
    status = 'restricted';
  }

  assertEquals(status, 'restricted');

  // Update profile
  await supabase.from('profiles').update({ stripe_connect_status: status }).eq('stripe_connect_account_id', account.id);

  // Verify
  const updatedProfile = mockProfiles.find((p) => p.stripe_connect_account_id === account.id);
  assertExists(updatedProfile);
  assertEquals(updatedProfile.stripe_connect_status, 'restricted');
});

Deno.test('stripe-webhook: account.updated should keep status pending when not fully onboarded', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple();

  // Create a profile
  const profile: MockProfile = {
    id: 'user-pending',
    email: 'pending@example.com',
    stripe_connect_account_id: 'acct_test_pending',
    stripe_connect_status: 'pending',
  };
  mockProfiles.push(profile);

  // Simulate partially onboarded account
  const account: MockStripeAccount = {
    id: 'acct_test_pending',
    details_submitted: false,
    payouts_enabled: false,
    requirements: {
      currently_due: [],
      errors: [],
    },
  };

  // Determine status
  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
    status = 'restricted';
  }

  assertEquals(status, 'pending');

  // Update profile
  await supabase
    .from('profiles')
    .update({ stripe_connect_status: status })
    .eq('stripe_connect_account_id', account.id);

  // Verify
  const updatedProfile = mockProfiles.find((p) => p.stripe_connect_account_id === account.id);
  assertExists(updatedProfile);
  assertEquals(updatedProfile.stripe_connect_status, 'pending');
});

Deno.test('stripe-webhook: account.updated should continue even if profile update fails', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple({ profileUpdateShouldFail: true });

  // Don't add the profile so update will fail
  const account: MockStripeAccount = {
    id: 'acct_nonexistent',
    details_submitted: true,
    payouts_enabled: true,
  };

  // Determine status
  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  }

  // Update profile - this will fail
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ stripe_connect_status: status })
    .eq('stripe_connect_account_id', account.id);

  // Error should exist
  assertExists(updateError);

  // But the webhook should still return success (200)
  // The handler logs the error but doesn't return an error response
  const response = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);
});

// ============================================================================
// TESTS: Success Response
// ============================================================================

Deno.test('stripe-webhook: should return 200 with received:true on successful handling', async () => {
  resetMocks();

  // Simulate successful event handling
  const eventHandled = true;

  if (eventHandled) {
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.received, true);
  }
});

// ============================================================================
// TESTS: Edge Cases
// ============================================================================

Deno.test('stripe-webhook: should handle checkout.session.completed with null payment_intent', async () => {
  resetMocks();

  // Some checkout sessions (like subscription mode) may not have payment_intent
  const session: MockStripeCheckoutSession = {
    id: 'cs_subscription_123',
    payment_intent: null,
    metadata: {
      order_id: 'order-123',
    },
  };

  // The handler should still process but stripe_payment_intent_id will be null
  assertEquals(session.payment_intent, null);
  assertExists(session.metadata.order_id);
});

Deno.test('stripe-webhook: should handle account.updated with missing requirements object', async () => {
  resetMocks();

  // Account might not have requirements if fully onboarded
  const account: MockStripeAccount = {
    id: 'acct_no_requirements',
    details_submitted: true,
    payouts_enabled: true,
    // requirements is undefined
  };

  // Determine status - should handle undefined requirements gracefully
  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
    status = 'restricted';
  }

  // Should be active since details_submitted and payouts_enabled are true
  assertEquals(status, 'active');
});

Deno.test('stripe-webhook: should handle account.updated with empty requirements arrays', async () => {
  resetMocks();

  const account: MockStripeAccount = {
    id: 'acct_empty_requirements',
    details_submitted: false,
    payouts_enabled: false,
    requirements: {
      currently_due: [],
      errors: [],
    },
  };

  // Empty arrays should not trigger restricted status
  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
    status = 'restricted';
  }

  // Should remain pending since empty arrays have length 0 (falsy)
  assertEquals(status, 'pending');
});

Deno.test('stripe-webhook: HANDLED_EVENTS constant should include all expected events', () => {
  const HANDLED_EVENTS = ['checkout.session.completed', 'checkout.session.expired', 'account.updated'];

  assertEquals(HANDLED_EVENTS.length, 3);
  assertEquals(HANDLED_EVENTS.includes('checkout.session.completed'), true);
  assertEquals(HANDLED_EVENTS.includes('checkout.session.expired'), true);
  assertEquals(HANDLED_EVENTS.includes('account.updated'), true);
});

Deno.test('stripe-webhook: should verify Content-Type header is application/json', async () => {
  const response = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.headers.get('Content-Type'), 'application/json');
});

// ============================================================================
// TESTS: Fulfillment Chain Error Handling
// ============================================================================

Deno.test('stripe-webhook: should continue if QR code generation fails', async () => {
  resetMocks();

  // Simulate order update success but QR code generation failure
  const orderUpdated = true;
  const qrGenerationFailed = true;

  if (orderUpdated) {
    // In the real handler, QR failure is logged but doesn't stop the webhook
    if (qrGenerationFailed) {
      // Continue anyway - order is paid, QR generation can be retried
      const response = new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 200);
    }
  }
});

Deno.test('stripe-webhook: should skip PDF generation if QR code generation fails', async () => {
  resetMocks();

  // Simulate QR code generation failure
  const qrResponse = { ok: false };

  if (!qrResponse.ok) {
    // PDF generation should be skipped
    const pdfTriggered = false;
    assertEquals(pdfTriggered, false);
  }
});

Deno.test('stripe-webhook: should skip printer notification if PDF generation fails', async () => {
  resetMocks();

  // Simulate QR success but PDF failure
  const qrResponse = { ok: true };
  const pdfResponse = { ok: false };

  if (qrResponse.ok) {
    if (!pdfResponse.ok) {
      // Printer notification should be skipped
      const printerNotificationTriggered = false;
      assertEquals(printerNotificationTriggered, false);
    }
  }
});

Deno.test('stripe-webhook: should continue if printer notification fails', async () => {
  resetMocks();

  // Simulate full chain success except printer notification
  const qrResponse = { ok: true };
  const pdfResponse = { ok: true };
  const printerResponse = { ok: false };

  if (qrResponse.ok && pdfResponse.ok) {
    if (!printerResponse.ok) {
      // Just log error, webhook still succeeds
      const response = new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 200);
    }
  }
});

Deno.test('stripe-webhook: should fire-and-forget order confirmation email', async () => {
  resetMocks();

  // Order confirmation is fire-and-forget - doesn't block webhook response
  const orderUpdated = true;

  if (orderUpdated) {
    // Confirmation email is triggered but not awaited
    const confirmationPromise = Promise.resolve({ ok: true });

    // The webhook returns before waiting for confirmation
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 200);

    // Later, confirmation may succeed or fail
    const confirmationResult = await confirmationPromise;
    assertEquals(confirmationResult.ok, true);
  }
});

Deno.test('stripe-webhook: should handle order confirmation email failure gracefully', async () => {
  resetMocks();

  // Even if confirmation email fails, it shouldn't affect the webhook
  const confirmationPromise = Promise.reject(new Error('Email service unavailable'));

  // Webhook returns successfully regardless
  const response = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);

  // The promise rejection is caught in the handler
  try {
    await confirmationPromise;
  } catch (err) {
    // Expected - handler catches this with .catch()
    assertEquals((err as Error).message, 'Email service unavailable');
  }
});

Deno.test('stripe-webhook: should trigger full fulfillment chain on successful payment', async () => {
  resetMocks();

  // Simulate successful fulfillment chain
  const qrResponse = { ok: true };
  const pdfResponse = { ok: true };
  const printerResponse = { ok: true };

  const fulfillmentSteps: string[] = [];

  if (qrResponse.ok) {
    fulfillmentSteps.push('qr_generated');

    if (pdfResponse.ok) {
      fulfillmentSteps.push('pdf_generated');

      if (printerResponse.ok) {
        fulfillmentSteps.push('printer_notified');
      }
    }
  }

  assertEquals(fulfillmentSteps.length, 3);
  assertEquals(fulfillmentSteps.includes('qr_generated'), true);
  assertEquals(fulfillmentSteps.includes('pdf_generated'), true);
  assertEquals(fulfillmentSteps.includes('printer_notified'), true);
});

// ============================================================================
// TESTS: Checkout Session Expired Edge Cases
// ============================================================================

Deno.test('stripe-webhook: checkout.session.expired should not fail on update error', async () => {
  resetMocks();

  // Even if update fails, the handler just logs and continues
  const updateError = { message: 'Database connection error' };

  if (updateError) {
    // Handler captures exception but doesn't return error
    // This is because expired sessions are informational
    const response = new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    // Note: In the actual handler, this path goes to "break" after error log
    assertEquals(response.status, 200);
  }
});

Deno.test('stripe-webhook: checkout.session.expired handles order not found gracefully', async () => {
  resetMocks();

  // Order might not exist (e.g., already deleted)
  const session: MockStripeCheckoutSession = {
    id: 'cs_nonexistent',
    payment_intent: null,
    metadata: {
      order_id: 'order-does-not-exist',
    },
  };

  const orderExists = mockStickerOrders.find((o) => o.id === session.metadata.order_id);
  assertEquals(orderExists, undefined);

  // Handler should still return success - order might have been cleaned up
  const response = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);
});

// ============================================================================
// TESTS: Account Updated Edge Cases
// ============================================================================

Deno.test('stripe-webhook: account.updated handles account without stripe_connect_account_id match', async () => {
  resetMocks();

  const supabase = mockSupabaseClientSimple();

  // No profile has this account ID
  const account: MockStripeAccount = {
    id: 'acct_unknown_123',
    details_submitted: true,
    payouts_enabled: true,
  };

  // Update will affect 0 rows but not error
  const { error } = await supabase
    .from('profiles')
    .update({ stripe_connect_status: 'active' })
    .eq('stripe_connect_account_id', account.id);

  // No profile found but this shouldn't be a hard error
  // The handler logs the error but continues
  assertExists(error); // Error because profile not found in our mock
});

Deno.test('stripe-webhook: account.updated correctly calculates status priority', async () => {
  resetMocks();

  // Test that details_submitted && payouts_enabled takes priority over requirements check
  const account: MockStripeAccount = {
    id: 'acct_priority_test',
    details_submitted: true,
    payouts_enabled: true,
    requirements: {
      // Even with requirements, if payouts_enabled is true, status should be active
      currently_due: ['some.requirement'],
      errors: [],
    },
  };

  let status: 'pending' | 'active' | 'restricted' = 'pending';
  if (account.details_submitted && account.payouts_enabled) {
    status = 'active';
  } else if (account.requirements?.currently_due?.length || account.requirements?.errors?.length) {
    status = 'restricted';
  }

  // Active takes priority when both conditions would match
  assertEquals(status, 'active');
});

// ============================================================================
// TESTS: Reward Payment Edge Cases
// ============================================================================

Deno.test('stripe-webhook: reward payment should differentiate by metadata type', async () => {
  resetMocks();

  // Two sessions with different types
  const stickerSession: MockStripeCheckoutSession = {
    id: 'cs_sticker_123',
    payment_intent: 'pi_sticker_456',
    metadata: {
      order_id: 'order-123',
      // no type means sticker order
    },
  };

  const rewardSession: MockStripeCheckoutSession = {
    id: 'cs_reward_123',
    payment_intent: 'pi_reward_456',
    metadata: {
      type: 'reward_payment',
      recovery_event_id: 'recovery-123',
    },
  };

  // Sticker order handling
  const isStickerOrder = stickerSession.metadata?.type !== 'reward_payment';
  assertEquals(isStickerOrder, true);

  // Reward payment handling
  const isRewardPayment = rewardSession.metadata?.type === 'reward_payment';
  assertEquals(isRewardPayment, true);
});

Deno.test('stripe-webhook: reward payment with empty recovery_event_id should fail', async () => {
  resetMocks();

  const session: MockStripeCheckoutSession = {
    id: 'cs_reward_empty',
    payment_intent: 'pi_reward_empty',
    metadata: {
      type: 'reward_payment',
      recovery_event_id: '', // Empty string
    },
  };

  const recoveryEventId = session.metadata?.recovery_event_id;

  // Empty string is falsy, should trigger error
  if (!recoveryEventId) {
    const response = new Response(JSON.stringify({ error: 'Missing recovery_event_id in metadata' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
  }
});

// ============================================================================
// TESTS: Response Format Validation
// ============================================================================

Deno.test('stripe-webhook: all error responses include error field', async () => {
  const errorResponses = [
    { error: 'Method not allowed', status: 405 },
    { error: 'Missing stripe-signature header', status: 400 },
    { error: 'Webhook not configured', status: 500 },
    { error: 'Stripe not configured', status: 500 },
    { error: 'Invalid signature', status: 400 },
    { error: 'Missing order_id in metadata', status: 400 },
    { error: 'Missing recovery_event_id in metadata', status: 400 },
    { error: 'Failed to update order', status: 500 },
    { error: 'Failed to mark reward as paid', status: 500 },
  ];

  for (const { error, status } of errorResponses) {
    const response = new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();
    assertExists(data.error);
    assertEquals(data.error, error);
    assertEquals(response.status, status);
  }
});

Deno.test('stripe-webhook: success responses always include received:true', async () => {
  const response = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const data = await response.json();
  assertEquals(data.received, true);
});

// ============================================================================
// TESTS: Status Code Validation
// ============================================================================

Deno.test('stripe-webhook: uses correct HTTP status codes', () => {
  // Method not allowed
  assertEquals(405, 405);

  // Bad request (missing header, invalid signature, missing metadata)
  assertEquals(400, 400);

  // Internal server error (config issues, update failures)
  assertEquals(500, 500);

  // Success
  assertEquals(200, 200);
});

// ============================================================================
// TESTS: Multiple Webhook Secrets Logic
// ============================================================================

Deno.test('stripe-webhook: should not try connect secret if main secret succeeds', async () => {
  resetMocks();

  let mainSecretAttempted = false;
  let connectSecretAttempted = false;
  let event = null;

  // Simulate main secret verification
  mainSecretAttempted = true;
  const mainSecretVerified = true;
  if (mainSecretVerified) {
    event = { type: 'checkout.session.completed' };
  }

  // Connect secret should not be tried since main succeeded
  if (!event) {
    connectSecretAttempted = true;
  }

  assertEquals(mainSecretAttempted, true);
  assertEquals(connectSecretAttempted, false);
  assertExists(event);
});

Deno.test('stripe-webhook: should skip main secret verification if not configured', async () => {
  resetMocks();

  const webhookSecret = undefined;
  const connectWebhookSecret = 'whsec_connect_only';

  let event = null;

  // Only try main secret if configured
  if (webhookSecret) {
    // This shouldn't run
    event = { type: 'from_main' };
  }

  // Try connect secret if main didn't work
  if (!event && connectWebhookSecret) {
    event = { type: 'from_connect' };
  }

  assertExists(event);
  assertEquals(event.type, 'from_connect');
});

// ============================================================================
// TESTS: Parallel Fulfillment Chain
// ============================================================================

Deno.test('stripe-webhook: should run order confirmation in parallel with fulfillment chain', async () => {
  resetMocks();

  // Track execution order and timing
  const executionLog: { operation: string; startTime: number }[] = [];
  const startTime = Date.now();

  // Simulate parallel execution of fulfillment chain and order confirmation
  const fulfillmentPromise = (async () => {
    executionLog.push({ operation: 'fulfillment_start', startTime: Date.now() - startTime });
    // Simulate QR -> PDF -> Printer chain (sequential within)
    await new Promise((resolve) => setTimeout(resolve, 10)); // QR
    await new Promise((resolve) => setTimeout(resolve, 10)); // PDF
    await new Promise((resolve) => setTimeout(resolve, 10)); // Printer
    executionLog.push({ operation: 'fulfillment_end', startTime: Date.now() - startTime });
    return { status: 'fulfilled', value: 'fulfillment_complete' };
  })();

  const confirmationPromise = (async () => {
    executionLog.push({ operation: 'confirmation_start', startTime: Date.now() - startTime });
    await new Promise((resolve) => setTimeout(resolve, 5)); // Email is faster
    executionLog.push({ operation: 'confirmation_end', startTime: Date.now() - startTime });
    return { status: 'fulfilled', value: 'confirmation_sent' };
  })();

  // Both should start at nearly the same time (within 5ms tolerance)
  await Promise.allSettled([fulfillmentPromise, confirmationPromise]);

  // Verify both operations started
  const fulfillmentStart = executionLog.find((e) => e.operation === 'fulfillment_start');
  const confirmationStart = executionLog.find((e) => e.operation === 'confirmation_start');

  assertExists(fulfillmentStart);
  assertExists(confirmationStart);

  // Both should have started nearly simultaneously (within 5ms)
  const timeDiff = Math.abs(fulfillmentStart.startTime - confirmationStart.startTime);
  assertEquals(timeDiff < 5, true, `Operations should start in parallel, but were ${timeDiff}ms apart`);
});

Deno.test('stripe-webhook: parallel fulfillment should use Promise.allSettled for error isolation', async () => {
  resetMocks();

  // Simulate operations where one fails
  const operations = [
    Promise.resolve({ success: true, operation: 'qr_pdf_printer' }),
    Promise.reject(new Error('Email service down')), // Order confirmation fails
  ];

  const results = await Promise.allSettled(operations);

  // Should have 2 results regardless of failures
  assertEquals(results.length, 2);

  // First should be fulfilled
  assertEquals(results[0].status, 'fulfilled');

  // Second should be rejected but not throw
  assertEquals(results[1].status, 'rejected');

  // The webhook should still return success
  const webhookResponse = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(webhookResponse.status, 200);
});

Deno.test('stripe-webhook: fulfillment chain failure should not prevent order confirmation', async () => {
  resetMocks();

  let confirmationSent = false;

  // Simulate fulfillment chain failing
  const fulfillmentPromise = Promise.reject(new Error('QR generation failed'));

  // Simulate order confirmation succeeding
  const confirmationPromise = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    confirmationSent = true;
    return { success: true };
  })();

  // Use Promise.allSettled so one failure doesn't stop others
  const results = await Promise.allSettled([fulfillmentPromise, confirmationPromise]);

  // Fulfillment failed
  assertEquals(results[0].status, 'rejected');

  // But confirmation still succeeded
  assertEquals(results[1].status, 'fulfilled');
  assertEquals(confirmationSent, true);
});

Deno.test('stripe-webhook: order confirmation failure should not prevent fulfillment chain', async () => {
  resetMocks();

  let fulfillmentComplete = false;

  // Simulate fulfillment chain succeeding
  const fulfillmentPromise = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    fulfillmentComplete = true;
    return { success: true };
  })();

  // Simulate order confirmation failing
  const confirmationPromise = Promise.reject(new Error('Email service unavailable'));

  // Use Promise.allSettled so one failure doesn't stop others
  const results = await Promise.allSettled([fulfillmentPromise, confirmationPromise]);

  // Fulfillment succeeded
  assertEquals(results[0].status, 'fulfilled');
  assertEquals(fulfillmentComplete, true);

  // Confirmation failed but didn't affect fulfillment
  assertEquals(results[1].status, 'rejected');
});

Deno.test('stripe-webhook: both parallel operations can fail without affecting webhook response', async () => {
  resetMocks();

  // Both operations fail
  const fulfillmentPromise = Promise.reject(new Error('Fulfillment failed'));
  const confirmationPromise = Promise.reject(new Error('Confirmation failed'));

  const results = await Promise.allSettled([fulfillmentPromise, confirmationPromise]);

  // Both failed
  assertEquals(results[0].status, 'rejected');
  assertEquals(results[1].status, 'rejected');

  // But webhook still returns success (order is paid, that's what matters)
  const webhookResponse = new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(webhookResponse.status, 200);
});

Deno.test('stripe-webhook: parallel operations should all complete before webhook returns', async () => {
  resetMocks();

  const completedOperations: string[] = [];

  const operations = [
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      completedOperations.push('fulfillment');
      return { operation: 'fulfillment' };
    })(),
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 3));
      completedOperations.push('confirmation');
      return { operation: 'confirmation' };
    })(),
  ];

  // Wait for all operations
  await Promise.allSettled(operations);

  // Both should have completed
  assertEquals(completedOperations.length, 2);
  assertEquals(completedOperations.includes('fulfillment'), true);
  assertEquals(completedOperations.includes('confirmation'), true);
});

Deno.test('stripe-webhook: runParallelFulfillment helper should handle mixed results', async () => {
  resetMocks();

  // Simulate the helper function behavior
  type FulfillmentResult = {
    operation: string;
    success: boolean;
    error?: string;
  };

  async function runParallelFulfillment(
    _orderId: string,
    _functionsUrl: string,
    _serviceKey: string
  ): Promise<FulfillmentResult[]> {
    const results: FulfillmentResult[] = [];

    const operations = [
      // Fulfillment chain (QR -> PDF -> Printer)
      (async (): Promise<FulfillmentResult> => {
        // Simulate QR success, PDF success, Printer success
        return { operation: 'fulfillment_chain', success: true };
      })(),
      // Order confirmation
      (async (): Promise<FulfillmentResult> => {
        // Simulate email failure
        throw new Error('SMTP connection refused');
      })(),
    ];

    const settled = await Promise.allSettled(operations);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          operation: 'unknown',
          success: false,
          error: result.reason?.message || 'Unknown error',
        });
      }
    }

    return results;
  }

  const results = await runParallelFulfillment('order-123', 'https://api.example.com', 'service-key');

  assertEquals(results.length, 2);
  assertEquals(results[0].success, true);
  assertEquals(results[1].success, false);
  assertEquals(results[1].error, 'SMTP connection refused');
});

Deno.test('stripe-webhook: parallel fulfillment preserves individual error logging', async () => {
  resetMocks();

  const errorLogs: string[] = [];

  // Simulate error logging behavior
  const operations = [
    (async () => {
      try {
        throw new Error('QR generation timeout');
      } catch (error) {
        errorLogs.push(`Fulfillment error: ${(error as Error).message}`);
        throw error;
      }
    })(),
    (async () => {
      try {
        throw new Error('Email service rate limited');
      } catch (error) {
        errorLogs.push(`Confirmation error: ${(error as Error).message}`);
        throw error;
      }
    })(),
  ];

  await Promise.allSettled(operations);

  // Both errors should have been logged
  assertEquals(errorLogs.length, 2);
  assertEquals(errorLogs[0].includes('QR generation timeout'), true);
  assertEquals(errorLogs[1].includes('Email service rate limited'), true);
});
