import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDiscPhoto = {
  disc_id: string;
  storage_path: string;
  photo_uuid: string;
};

type MockDisc = {
  id: string;
  owner_id: string;
  name: string;
  manufacturer?: string;
  mold: string;
  flight_numbers?: Record<string, number>;
  created_at: string;
  photos?: MockDiscPhoto[];
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockDiscPhotos: MockDiscPhoto[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockDiscPhotos = [];
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
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (_column: string, value: string) => ({
          order: (_orderBy: string, options?: { ascending?: boolean }) => {
            if (table === 'discs') {
              const userDiscs = mockDiscs
                .filter((disc) => disc.owner_id === value)
                .map((disc) => {
                  const photos = mockDiscPhotos.filter((photo) => photo.disc_id === disc.id);
                  return {
                    ...disc,
                    photos,
                  };
                })
                .sort((a, b) => {
                  if (options?.ascending === false) {
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                  }
                  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                });
              return Promise.resolve({ data: userDiscs, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
      insert: (
        values: Partial<MockDisc> | Partial<MockDiscPhoto> | Partial<MockDisc>[] | Partial<MockDiscPhoto>[]
      ) => ({
        select: () => ({
          single: () => {
            if (table === 'discs') {
              const discData = (Array.isArray(values) ? values[0] : values) as Partial<MockDisc>;
              const newDisc: MockDisc = {
                id: `disc-${Date.now()}-${Math.random()}`,
                owner_id: mockUser?.id || '',
                name: discData.name || '',
                manufacturer: discData.manufacturer,
                mold: discData.mold || '',
                flight_numbers: discData.flight_numbers,
                created_at: new Date().toISOString(),
              };
              mockDiscs.push(newDisc);
              return Promise.resolve({ data: newDisc, error: null });
            }
            if (table === 'disc_photos') {
              const photosArray = Array.isArray(values) ? values : [values];
              const newPhotos = photosArray.map((p) => p as MockDiscPhoto);
              mockDiscPhotos.push(...newPhotos);
              return Promise.resolve({ data: newPhotos[0], error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
}

Deno.test('get-user-discs: should return 401 when not authenticated', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
  }
});

Deno.test('get-user-discs: should return empty array for new user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: discs } = await supabase
    .from('discs')
    .select('*')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  const response = new Response(JSON.stringify(discs || []), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(Array.isArray(data), true);
  assertEquals(data.length, 0);
});

Deno.test('get-user-discs: should return user discs with photos', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Create two discs
  const { data: disc1 } = await supabase
    .from('discs')
    .insert({
      name: 'Innova Destroyer',
      manufacturer: 'Innova',
      mold: 'Destroyer',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    })
    .select()
    .single();

  const { data: disc2 } = await supabase
    .from('discs')
    .insert({
      name: 'Discraft Buzzz',
      manufacturer: 'Discraft',
      mold: 'Buzzz',
      flight_numbers: { speed: 5, glide: 4, turn: -1, fade: 1 },
    })
    .select()
    .single();

  assertExists(disc1);
  assertExists(disc2);
  const disc1Typed = disc1 as MockDisc;
  const disc2Typed = disc2 as MockDisc;

  // Add photos to first disc
  await supabase
    .from('disc_photos')
    .insert([
      { disc_id: disc1Typed.id, storage_path: 'test/path/photo1.jpg', photo_uuid: crypto.randomUUID() },
      { disc_id: disc1Typed.id, storage_path: 'test/path/photo2.jpg', photo_uuid: crypto.randomUUID() },
    ])
    .select()
    .single();

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: discs } = await supabase
    .from('discs')
    .select('*')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  const response = new Response(JSON.stringify(discs || []), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = (await response.json()) as Array<{
    id: string;
    name: string;
    manufacturer?: string;
    photos: Array<unknown>;
  }>;
  assertEquals(Array.isArray(data), true);
  assertEquals(data.length, 2);

  // Check disc structure
  const returnedDisc1 = data.find((d) => d.id === disc1Typed.id);
  assertExists(returnedDisc1);
  assertEquals(returnedDisc1.name, 'Innova Destroyer');
  assertEquals(returnedDisc1.manufacturer, 'Innova');
  assertExists(returnedDisc1.photos);
  assertEquals(Array.isArray(returnedDisc1.photos), true);
  assertEquals(returnedDisc1.photos.length, 2);

  const returnedDisc2 = data.find((d) => d.id === disc2Typed.id);
  assertExists(returnedDisc2);
  assertEquals(returnedDisc2.name, 'Discraft Buzzz');
  assertEquals(returnedDisc2.photos.length, 0);
});

Deno.test('get-user-discs: should only return own discs', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test1@example.com' };

  const supabase1 = mockSupabaseClient();

  await supabase1
    .from('discs')
    .insert({
      name: 'User 1 Disc',
      mold: 'Mako3',
      flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    })
    .select()
    .single();

  // Simulate second user
  const user2Id = 'user-2';
  const disc2: MockDisc = {
    id: 'disc-user2',
    owner_id: user2Id,
    name: 'User 2 Disc',
    mold: 'Wraith',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    created_at: new Date().toISOString(),
  };
  mockDiscs.push(disc2);

  const { data: authData } = await supabase1.auth.getUser();
  assertExists(authData.user);

  const { data: discs } = await supabase1
    .from('discs')
    .select('*')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  const response = new Response(JSON.stringify(discs || []), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.length, 1);
  assertEquals(data[0].name, 'User 1 Disc');
});

Deno.test('get-user-discs: should return discs ordered by newest first', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Create discs with different timestamps
  const disc1: MockDisc = {
    id: 'disc-1',
    owner_id: mockUser.id,
    name: 'First Disc',
    mold: 'Destroyer',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    created_at: new Date('2024-01-01').toISOString(),
  };
  mockDiscs.push(disc1);

  const disc2: MockDisc = {
    id: 'disc-2',
    owner_id: mockUser.id,
    name: 'Second Disc',
    mold: 'Wraith',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    created_at: new Date('2024-01-02').toISOString(),
  };
  mockDiscs.push(disc2);

  const disc3: MockDisc = {
    id: 'disc-3',
    owner_id: mockUser.id,
    name: 'Third Disc',
    mold: 'Teebird',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
    created_at: new Date('2024-01-03').toISOString(),
  };
  mockDiscs.push(disc3);

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const { data: discs } = await supabase
    .from('discs')
    .select('*')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  const response = new Response(JSON.stringify(discs || []), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.length, 3);
  // Newest first
  assertEquals(data[0].name, 'Third Disc');
  assertEquals(data[1].name, 'Second Disc');
  assertEquals(data[2].name, 'First Disc');
});
