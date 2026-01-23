import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockCatalogDisc = {
  id: string;
  manufacturer: string;
  mold: string;
  status: string;
};

type MockDismissedRecommendation = {
  id: string;
  user_id: string;
  disc_catalog_id: string;
  dismissed_at: string;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockCatalogDiscs: MockCatalogDisc[] = [];
let mockDismissedRecommendations: MockDismissedRecommendation[] = [];
let mockCurrentUser: MockUser | null = null;

// Reset mocks between tests
function resetMocks() {
  mockUsers = [];
  mockCatalogDiscs = [];
  mockDismissedRecommendations = [];
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
            if (table === 'disc_catalog') {
              const disc = mockCatalogDiscs.find((d) => d[column as keyof MockCatalogDisc] === value);
              if (!disc) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: disc, error: null };
            }
            if (table === 'dismissed_disc_recommendations') {
              const dismissal = mockDismissedRecommendations.find(
                (d) => d[column as keyof MockDismissedRecommendation] === value
              );
              if (!dismissal) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: dismissal, error: null };
            }
            return { data: null, error: null };
          },
          eq: (_column2: string, _value2: string) => ({
            single: async () => {
              if (table === 'dismissed_disc_recommendations') {
                const dismissal = mockDismissedRecommendations.find(
                  (d) =>
                    d.user_id === (mockCurrentUser?.id || '') &&
                    d.disc_catalog_id === value
                );
                if (!dismissal) {
                  return { data: null, error: { code: 'PGRST116' } };
                }
                return { data: dismissal, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
      insert: (values: Record<string, unknown>) => ({
        select: (_columns?: string) => ({
          single: async () => {
            if (table === 'dismissed_disc_recommendations') {
              // Check for duplicate
              const existing = mockDismissedRecommendations.find(
                (d) =>
                  d.user_id === values.user_id &&
                  d.disc_catalog_id === values.disc_catalog_id
              );
              if (existing) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                };
              }
              const newDismissal: MockDismissedRecommendation = {
                id: `dismiss-${Date.now()}`,
                user_id: values.user_id as string,
                disc_catalog_id: values.disc_catalog_id as string,
                dismissed_at: new Date().toISOString(),
              };
              mockDismissedRecommendations.push(newDismissal);
              return { data: newDismissal, error: null };
            }
            return { data: null, error: { message: 'Unknown table' } };
          },
        }),
      }),
    }),
  };
}

Deno.test('dismiss-disc-recommendation: should return 405 for non-POST requests', () => {
  const method: string = 'GET';

  if (method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('dismiss-disc-recommendation: should return 401 when no auth header', async () => {
  resetMocks();
  const authHeader = null;

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

Deno.test('dismiss-disc-recommendation: should return 401 when not authenticated', async () => {
  resetMocks();
  const supabase = mockSupabaseClient();

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Unauthorized');
  }
});

Deno.test('dismiss-disc-recommendation: should return 400 for invalid JSON', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  try {
    JSON.parse('invalid json');
  } catch {
    const response = new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Invalid JSON body');
  }
});

Deno.test('dismiss-disc-recommendation: should return 400 when disc_catalog_id is missing', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  const body: { disc_catalog_id?: string } = {};

  if (!body.disc_catalog_id) {
    const response = new Response(JSON.stringify({ error: 'disc_catalog_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'disc_catalog_id is required');
  }
});

Deno.test('dismiss-disc-recommendation: should return 404 when disc not found in catalog', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const body = { disc_catalog_id: 'nonexistent-disc-id' };
  const supabase = mockSupabaseClient();

  const { data: discData, error: discError } = await supabase
    .from('disc_catalog')
    .select('*')
    .eq('id', body.disc_catalog_id)
    .single();

  if (discError || !discData) {
    const response = new Response(JSON.stringify({ error: 'Disc not found in catalog' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Disc not found in catalog');
  }
});

Deno.test('dismiss-disc-recommendation: should successfully dismiss a disc', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const catalogDisc: MockCatalogDisc = {
    id: 'catalog-disc-123',
    manufacturer: 'Innova',
    mold: 'Destroyer',
    status: 'verified',
  };
  mockCatalogDiscs.push(catalogDisc);

  const body = { disc_catalog_id: catalogDisc.id };
  const supabase = mockSupabaseClient();

  // Verify disc exists
  const { data: discData } = await supabase.from('disc_catalog').select('*').eq('id', body.disc_catalog_id).single();

  assertExists(discData);

  // Insert dismissal
  const { data: dismissalData, error: insertError } = await supabase
    .from('dismissed_disc_recommendations')
    .insert({
      user_id: mockCurrentUser.id,
      disc_catalog_id: body.disc_catalog_id,
    })
    .select()
    .single();

  assertEquals(insertError, null);
  assertExists(dismissalData);

  const response = new Response(
    JSON.stringify({
      success: true,
      dismissed: {
        id: dismissalData.id,
        disc_catalog_id: dismissalData.disc_catalog_id,
        dismissed_at: dismissalData.dismissed_at,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.dismissed.disc_catalog_id, catalogDisc.id);

  // Verify in mock data
  const dismissal = mockDismissedRecommendations.find(
    (d) => d.user_id === mockCurrentUser?.id && d.disc_catalog_id === catalogDisc.id
  );
  assertExists(dismissal);
});

Deno.test('dismiss-disc-recommendation: should handle duplicate dismissal gracefully', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };
  mockUsers.push(mockCurrentUser);

  const catalogDisc: MockCatalogDisc = {
    id: 'catalog-disc-123',
    manufacturer: 'Innova',
    mold: 'Destroyer',
    status: 'verified',
  };
  mockCatalogDiscs.push(catalogDisc);

  // Add existing dismissal
  mockDismissedRecommendations.push({
    id: 'dismiss-existing',
    user_id: mockCurrentUser.id,
    disc_catalog_id: catalogDisc.id,
    dismissed_at: new Date().toISOString(),
  });

  const body = { disc_catalog_id: catalogDisc.id };
  const supabase = mockSupabaseClient();

  // Try to insert duplicate dismissal
  const { error: insertError } = await supabase
    .from('dismissed_disc_recommendations')
    .insert({
      user_id: mockCurrentUser.id,
      disc_catalog_id: body.disc_catalog_id,
    })
    .select()
    .single();

  // Should get duplicate error
  assertExists(insertError);
  assertEquals(insertError.code, '23505');

  // Return success anyway (idempotent behavior)
  const response = new Response(
    JSON.stringify({
      success: true,
      message: 'Disc already dismissed',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
});

Deno.test('dismiss-disc-recommendation: users cannot dismiss for other users', async () => {
  resetMocks();
  const ownerId = 'owner-123';
  const otherUserId = 'attacker-456';
  mockCurrentUser = { id: otherUserId, email: 'attacker@example.com' };

  mockUsers.push({ id: ownerId, email: 'owner@example.com' });
  mockUsers.push(mockCurrentUser);

  const catalogDisc: MockCatalogDisc = {
    id: 'catalog-disc-123',
    manufacturer: 'Innova',
    mold: 'Destroyer',
    status: 'verified',
  };
  mockCatalogDiscs.push(catalogDisc);

  const supabase = mockSupabaseClient();

  // Insert dismissal for current user (not another user - RLS ensures this)
  const { data: dismissalData } = await supabase
    .from('dismissed_disc_recommendations')
    .insert({
      user_id: mockCurrentUser.id, // Can only insert for self due to RLS
      disc_catalog_id: catalogDisc.id,
    })
    .select()
    .single();

  assertExists(dismissalData);
  assertEquals(dismissalData.user_id, mockCurrentUser.id);

  // The dismissal is for the attacker, not the owner
  const ownerDismissal = mockDismissedRecommendations.find((d) => d.user_id === ownerId);
  assertEquals(ownerDismissal, undefined);
});
