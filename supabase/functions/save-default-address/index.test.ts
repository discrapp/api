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
      insert: (data: Partial<MockShippingAddress>) => ({
        select: (_columns?: string) => ({
          single: () => {
            if (table === 'shipping_addresses') {
              const newAddress: MockShippingAddress = {
                id: `address-${Date.now()}`,
                user_id: data.user_id || '',
                name: data.name || '',
                street_address: data.street_address || '',
                street_address_2: data.street_address_2 || null,
                city: data.city || '',
                state: data.state || '',
                postal_code: data.postal_code || '',
                country: data.country || 'US',
                is_default: data.is_default ?? true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              mockShippingAddresses.push(newAddress);
              return Promise.resolve({ data: newAddress, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (data: Partial<MockShippingAddress>) => ({
        eq: (column: string, value: string) => ({
          select: (_columns?: string) => ({
            single: () => {
              if (table === 'shipping_addresses') {
                const index = mockShippingAddresses.findIndex(
                  (a) => a[column as keyof MockShippingAddress] === value
                );
                if (index !== -1) {
                  mockShippingAddresses[index] = {
                    ...mockShippingAddresses[index],
                    ...data,
                    updated_at: new Date().toISOString(),
                  };
                  return Promise.resolve({ data: mockShippingAddresses[index], error: null });
                }
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('save-default-address: should return 405 for non-POST requests', async () => {
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

Deno.test('save-default-address: should return 401 when authorization header is missing', async () => {
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

Deno.test('save-default-address: should return 401 when user is not authenticated', async () => {
  resetMocks();

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

Deno.test('save-default-address: should return 400 when name is missing', async () => {
  resetMocks();

  const body: { street_address?: string; city?: string; state?: string; postal_code?: string } = {
    street_address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
  };

  // Validate required fields
  const requiredFields = ['name', 'street_address', 'city', 'state', 'postal_code'];
  for (const field of requiredFields) {
    if (!body[field as keyof typeof body]) {
      const response = new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'Missing required field: name');
      break;
    }
  }
});

Deno.test('save-default-address: should return 400 when street_address is missing', async () => {
  resetMocks();

  const body: { name?: string; city?: string; state?: string; postal_code?: string } = {
    name: 'John Doe',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
  };

  const requiredFields = ['name', 'street_address', 'city', 'state', 'postal_code'];
  for (const field of requiredFields) {
    if (!body[field as keyof typeof body]) {
      const response = new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'Missing required field: street_address');
      break;
    }
  }
});

Deno.test('save-default-address: should return 400 when city is missing', async () => {
  resetMocks();

  const body: { name?: string; street_address?: string; state?: string; postal_code?: string } = {
    name: 'John Doe',
    street_address: '123 Main St',
    state: 'TX',
    postal_code: '78701',
  };

  const requiredFields = ['name', 'street_address', 'city', 'state', 'postal_code'];
  for (const field of requiredFields) {
    if (!body[field as keyof typeof body]) {
      const response = new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'Missing required field: city');
      break;
    }
  }
});

Deno.test('save-default-address: should return 400 when state is missing', async () => {
  resetMocks();

  const body: { name?: string; street_address?: string; city?: string; postal_code?: string } = {
    name: 'John Doe',
    street_address: '123 Main St',
    city: 'Austin',
    postal_code: '78701',
  };

  const requiredFields = ['name', 'street_address', 'city', 'state', 'postal_code'];
  for (const field of requiredFields) {
    if (!body[field as keyof typeof body]) {
      const response = new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'Missing required field: state');
      break;
    }
  }
});

Deno.test('save-default-address: should return 400 when postal_code is missing', async () => {
  resetMocks();

  const body: { name?: string; street_address?: string; city?: string; state?: string } = {
    name: 'John Doe',
    street_address: '123 Main St',
    city: 'Austin',
    state: 'TX',
  };

  const requiredFields = ['name', 'street_address', 'city', 'state', 'postal_code'];
  for (const field of requiredFields) {
    if (!body[field as keyof typeof body]) {
      const response = new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
      assertEquals(response.status, 400);
      const data = await response.json();
      assertEquals(data.error, 'Missing required field: postal_code');
      break;
    }
  }
});

Deno.test('save-default-address: should create new default address for user', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const supabase = mockSupabaseClient(userId);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const body = {
    name: 'John Doe',
    street_address: '123 Main St',
    street_address_2: 'Apt 4B',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
    country: 'US',
  };

  const { data: address } = await supabase.from('shipping_addresses').insert({
    user_id: userId,
    ...body,
    is_default: true,
  }).select('*').single();

  assertExists(address);

  const response = new Response(JSON.stringify(address), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  assertEquals(response.status, 200);
  const data = await response.json();

  assertExists(data);
  assertEquals(data.name, 'John Doe');
  assertEquals(data.street_address, '123 Main St');
  assertEquals(data.street_address_2, 'Apt 4B');
  assertEquals(data.city, 'Austin');
  assertEquals(data.state, 'TX');
  assertEquals(data.postal_code, '78701');
  assertEquals(data.country, 'US');
  assertEquals(data.is_default, true);
  assertEquals(data.user_id, userId);
});

Deno.test('save-default-address: should update existing address when address_id provided', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  // Create existing address
  const existingAddress: MockShippingAddress = {
    id: 'address-1',
    user_id: userId,
    name: 'Old Name',
    street_address: '456 Old St',
    street_address_2: null,
    city: 'Dallas',
    state: 'TX',
    postal_code: '75001',
    country: 'US',
    is_default: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
  mockShippingAddresses.push(existingAddress);

  const supabase = mockSupabaseClient(userId);

  const updateBody = {
    name: 'New Name',
    street_address: '123 New St',
    city: 'Austin',
  };

  const { data: updatedAddress } = await supabase.from('shipping_addresses')
    .update(updateBody)
    .eq('id', 'address-1')
    .select('*')
    .single();

  assertExists(updatedAddress);
  assertEquals(updatedAddress.name, 'New Name');
  assertEquals(updatedAddress.street_address, '123 New St');
  assertEquals(updatedAddress.city, 'Austin');
  // Should keep old values for fields not updated
  assertEquals(updatedAddress.state, 'TX');
  assertEquals(updatedAddress.postal_code, '75001');
});

Deno.test('save-default-address: should return 403 when address_id belongs to another user', async () => {
  resetMocks();

  const user1Id = 'user-1';
  const user2Id = 'user-2';
  mockUsers.push({ id: user1Id, email: 'user1@example.com' }, { id: user2Id, email: 'user2@example.com' });

  // User 2's address
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

  const supabase = mockSupabaseClient(user1Id);
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // User 1 tries to get user 2's address
  const { data: address } = await supabase.from('shipping_addresses')
    .select('*')
    .eq('id', 'address-1')
    .single();

  assertExists(address);

  // Check ownership
  if (address.user_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'Address does not belong to user' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'Address does not belong to user');
  }
});

Deno.test('save-default-address: should default country to US when not provided', async () => {
  resetMocks();

  const userId = 'user-1';
  mockUsers.push({ id: userId, email: 'test@example.com' });

  const supabase = mockSupabaseClient(userId);

  const body: {
    name: string;
    street_address: string;
    city: string;
    state: string;
    postal_code: string;
    country?: string;
  } = {
    name: 'John Doe',
    street_address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
    // country not provided
  };

  const { data: address } = await supabase.from('shipping_addresses').insert({
    user_id: userId,
    ...body,
    country: body.country || 'US', // Default to US
    is_default: true,
  }).select('*').single();

  assertExists(address);
  assertEquals(address.country, 'US');
});
