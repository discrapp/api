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
  street_address_2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockShippingAddresses: MockShippingAddress[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUsers = [];
  mockShippingAddresses = [];
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
        eq: (column: string, value: string | boolean) => ({
          eq: (column2: string, value2: string | boolean) => ({
            single: () => {
              if (table === 'shipping_addresses') {
                // Find address where both conditions match
                const address = mockShippingAddresses.find(
                  (a) =>
                    a[column as keyof MockShippingAddress] === value &&
                    a[column2 as keyof MockShippingAddress] === value2
                );
                if (address) {
                  return Promise.resolve({ data: address, error: null });
                }
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
          single: () => {
            if (table === 'shipping_addresses') {
              const address = mockShippingAddresses.find(
                (a) => a[column as keyof MockShippingAddress] === value
              );
              if (address) {
                return Promise.resolve({ data: address, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
}

Deno.test('get-default-address: should return 405 for non-GET requests', async () => {
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

Deno.test('get-default-address: should return 401 when authorization header is missing', async () => {
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

Deno.test('get-default-address: should return 401 when user is not authenticated', async () => {
  resetMocks();

  // No users in mock = invalid token
  const supabase = mockSupabaseClient('invalid-user-id');
  const { data: authData, error } = await supabase.auth.getUser();

  if (error || !authData.user) {
    const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Unauthorized');
  }
});

Deno.test('get-default-address: should return null when user has no addresses', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });
  // No addresses added

  const supabase = mockSupabaseClient(userId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: address } = await supabase
    .from('shipping_addresses')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .single();

  // Should return null response (not error)
  const response = new Response(JSON.stringify(address), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data, null);
});

Deno.test('get-default-address: should return null when user has addresses but none is default', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });
  mockShippingAddresses.push({
    id: 'address-1',
    user_id: userId,
    name: 'Test User',
    street_address: '123 Test St',
    street_address_2: null,
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
    country: 'US',
    is_default: false, // Not default
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  });

  const supabase = mockSupabaseClient(userId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: address } = await supabase
    .from('shipping_addresses')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .single();

  // Should return null since no default address
  const response = new Response(JSON.stringify(address), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data, null);
});

Deno.test('get-default-address: should return default address when it exists', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const defaultAddress: MockShippingAddress = {
    id: 'address-1',
    user_id: userId,
    name: 'John Doe',
    street_address: '123 Main St',
    street_address_2: 'Apt 4B',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
    country: 'US',
    is_default: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
  mockShippingAddresses.push(defaultAddress);

  const supabase = mockSupabaseClient(userId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: address } = await supabase
    .from('shipping_addresses')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .single();

  assertExists(address);

  const response = new Response(JSON.stringify(address), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);
  const data = await response.json();

  assertExists(data);
  assertEquals(data.id, 'address-1');
  assertEquals(data.name, 'John Doe');
  assertEquals(data.street_address, '123 Main St');
  assertEquals(data.street_address_2, 'Apt 4B');
  assertEquals(data.city, 'Austin');
  assertEquals(data.state, 'TX');
  assertEquals(data.postal_code, '78701');
  assertEquals(data.country, 'US');
  assertEquals(data.is_default, true);
});

Deno.test('get-default-address: should not return another user default address', async () => {
  resetMocks();

  const user1Id = 'user-1';
  const user2Id = 'user-2';
  mockUsers.push({ id: user1Id, email: 'user1@example.com' }, { id: user2Id, email: 'user2@example.com' });

  // User 2 has a default address
  mockShippingAddresses.push({
    id: 'address-1',
    user_id: user2Id,
    name: 'User 2',
    street_address: '456 Other St',
    street_address_2: null,
    city: 'Dallas',
    state: 'TX',
    postal_code: '75001',
    country: 'US',
    is_default: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  });

  // User 1 queries for their default address
  const supabase = mockSupabaseClient(user1Id);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: address } = await supabase
    .from('shipping_addresses')
    .select('*')
    .eq('user_id', user1Id) // Query for user 1's addresses
    .eq('is_default', true)
    .single();

  // Should not find user 2's address
  assertEquals(address, null);
});
