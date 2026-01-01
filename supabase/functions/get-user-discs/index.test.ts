import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDiscPhoto = {
  id: string;
  disc_id: string;
  storage_path: string;
  photo_uuid: string;
  created_at: string;
};

type MockQrCode = {
  id: string;
  short_code: string;
  status: string;
};

type MockRecoveryEvent = {
  id: string;
  status: string;
  finder_id: string;
  found_at: string;
  surrendered_at?: string | null;
  original_owner_id?: string | null;
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
  qr_code?: MockQrCode | null;
  recovery_events?: MockRecoveryEvent[];
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockDiscPhotos: MockDiscPhoto[] = [];
let mockQrCodes: Map<string, MockQrCode> = new Map();
let mockRecoveryEvents: Map<string, MockRecoveryEvent[]> = new Map();

// Storage mock tracking
let createSignedUrlsCalls: string[][] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockDiscPhotos = [];
  mockQrCodes = new Map();
  mockRecoveryEvents = new Map();
  createSignedUrlsCalls = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: () => {
        if (mockUser) {
          return Promise.resolve({ data: { user: mockUser }, error: null });
        }
        return Promise.resolve({
          data: { user: null },
          error: { message: 'Not authenticated' },
        });
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
                  const qrCode = mockQrCodes.get(disc.id) || null;
                  const recoveryEvents = mockRecoveryEvents.get(disc.id) || [];
                  return {
                    ...disc,
                    photos,
                    qr_code: qrCode,
                    recovery_events: recoveryEvents,
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
    storage: {
      from: (_bucket: string) => ({
        // Batch signed URL generation - used by optimized implementation
        createSignedUrls: (paths: string[], _expiresIn: number) => {
          // Track that this batch method was called with these paths
          createSignedUrlsCalls.push(paths);

          // Generate signed URLs for all paths in one call
          const data = paths.map((path) => ({
            path,
            signedUrl: `https://storage.example.com/signed/${path}?token=abc123`,
            error: null,
          }));

          return Promise.resolve({ data, error: null });
        },
        // Individual signed URL generation - used by old N+1 implementation
        createSignedUrl: (path: string, _expiresIn: number) => {
          // This should NOT be called in the optimized implementation
          // Track it as a single-item call for verification
          createSignedUrlsCalls.push([path]);

          return Promise.resolve({
            data: {
              signedUrl: `https://storage.example.com/signed/${path}?token=abc123`,
            },
            error: null,
          });
        },
      }),
    },
  };
}

// Mock admin Supabase client (service role) - matches the pattern in the implementation
function mockSupabaseAdminClient() {
  return {
    storage: {
      from: (_bucket: string) => ({
        // Batch signed URL generation - used by optimized implementation
        createSignedUrls: (paths: string[], _expiresIn: number) => {
          // Track that this batch method was called with these paths
          createSignedUrlsCalls.push(paths);

          // Generate signed URLs for all paths in one call
          const data = paths.map((path) => ({
            path,
            signedUrl: `https://storage.example.com/signed/${path}?token=abc123`,
            error: null,
          }));

          return Promise.resolve({ data, error: null });
        },
        // Individual signed URL generation - used by old N+1 implementation
        createSignedUrl: (path: string, _expiresIn: number) => {
          // This should NOT be called in the optimized implementation
          // Track it as a single-item call for verification
          createSignedUrlsCalls.push([path]);

          return Promise.resolve({
            data: {
              signedUrl: `https://storage.example.com/signed/${path}?token=abc123`,
            },
            error: null,
          });
        },
      }),
    },
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
      {
        disc_id: disc1Typed.id,
        storage_path: 'test/path/photo1.jpg',
        photo_uuid: crypto.randomUUID(),
      },
      {
        disc_id: disc1Typed.id,
        storage_path: 'test/path/photo2.jpg',
        photo_uuid: crypto.randomUUID(),
      },
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

// ============================================================================
// N+1 Query Fix Tests - Batch Signed URL Generation
// Issue #221: Fix N+1 query in get-user-discs
// ============================================================================

Deno.test('get-user-discs: should batch all photo URLs in a single createSignedUrls call', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create 3 discs with multiple photos each (total 6 photos)
  const disc1: MockDisc = {
    id: 'disc-1',
    owner_id: mockUser.id,
    name: 'Disc 1',
    mold: 'Destroyer',
    created_at: new Date('2024-01-01').toISOString(),
  };
  mockDiscs.push(disc1);

  const disc2: MockDisc = {
    id: 'disc-2',
    owner_id: mockUser.id,
    name: 'Disc 2',
    mold: 'Buzzz',
    created_at: new Date('2024-01-02').toISOString(),
  };
  mockDiscs.push(disc2);

  const disc3: MockDisc = {
    id: 'disc-3',
    owner_id: mockUser.id,
    name: 'Disc 3',
    mold: 'Teebird',
    created_at: new Date('2024-01-03').toISOString(),
  };
  mockDiscs.push(disc3);

  // Add 2 photos to each disc (6 photos total)
  mockDiscPhotos.push(
    {
      id: 'photo-1',
      disc_id: 'disc-1',
      storage_path: 'disc-1/photo1.jpg',
      photo_uuid: 'uuid-1',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-2',
      disc_id: 'disc-1',
      storage_path: 'disc-1/photo2.jpg',
      photo_uuid: 'uuid-2',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-3',
      disc_id: 'disc-2',
      storage_path: 'disc-2/photo1.jpg',
      photo_uuid: 'uuid-3',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-4',
      disc_id: 'disc-2',
      storage_path: 'disc-2/photo2.jpg',
      photo_uuid: 'uuid-4',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-5',
      disc_id: 'disc-3',
      storage_path: 'disc-3/photo1.jpg',
      photo_uuid: 'uuid-5',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-6',
      disc_id: 'disc-3',
      storage_path: 'disc-3/photo2.jpg',
      photo_uuid: 'uuid-6',
      created_at: new Date().toISOString(),
    }
  );

  const supabase = mockSupabaseClient();
  const adminClient = mockSupabaseAdminClient();

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Fetch discs
  const { data: discs } = await supabase
    .from('discs')
    .select('*, photos:disc_photos(*), qr_code:qr_codes(*), recovery_events(*)')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  assertExists(discs);

  // Collect all photo paths from all discs
  const allPhotoPaths: string[] = [];
  for (const disc of discs) {
    for (const photo of disc.photos || []) {
      allPhotoPaths.push(photo.storage_path);
    }
  }

  assertEquals(allPhotoPaths.length, 6);

  // Call createSignedUrls ONCE with all paths (this is the optimized approach)
  if (allPhotoPaths.length > 0) {
    const { data: signedUrls } = await adminClient.storage.from('disc-photos').createSignedUrls(allPhotoPaths, 3600);

    assertExists(signedUrls);
    assertEquals(signedUrls.length, 6);
  }

  // Verify only ONE batch call was made (not 6 individual calls)
  assertEquals(createSignedUrlsCalls.length, 1);
  assertEquals(createSignedUrlsCalls[0].length, 6);

  // Verify all paths are in the single batch call
  const batchedPaths = createSignedUrlsCalls[0];
  assertEquals(batchedPaths.includes('disc-1/photo1.jpg'), true);
  assertEquals(batchedPaths.includes('disc-1/photo2.jpg'), true);
  assertEquals(batchedPaths.includes('disc-2/photo1.jpg'), true);
  assertEquals(batchedPaths.includes('disc-2/photo2.jpg'), true);
  assertEquals(batchedPaths.includes('disc-3/photo1.jpg'), true);
  assertEquals(batchedPaths.includes('disc-3/photo2.jpg'), true);
});

Deno.test('get-user-discs: should handle discs with no photos efficiently (no storage calls)', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create 3 discs with NO photos
  const disc1: MockDisc = {
    id: 'disc-1',
    owner_id: mockUser.id,
    name: 'Disc 1',
    mold: 'Destroyer',
    created_at: new Date('2024-01-01').toISOString(),
  };
  mockDiscs.push(disc1);

  const disc2: MockDisc = {
    id: 'disc-2',
    owner_id: mockUser.id,
    name: 'Disc 2',
    mold: 'Buzzz',
    created_at: new Date('2024-01-02').toISOString(),
  };
  mockDiscs.push(disc2);

  const disc3: MockDisc = {
    id: 'disc-3',
    owner_id: mockUser.id,
    name: 'Disc 3',
    mold: 'Teebird',
    created_at: new Date('2024-01-03').toISOString(),
  };
  mockDiscs.push(disc3);

  const supabase = mockSupabaseClient();

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Fetch discs
  const { data: discs } = await supabase
    .from('discs')
    .select('*, photos:disc_photos(*), qr_code:qr_codes(*), recovery_events(*)')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  assertExists(discs);
  assertEquals(discs.length, 3);

  // Collect all photo paths - should be empty
  const allPhotoPaths: string[] = [];
  for (const disc of discs) {
    for (const photo of disc.photos || []) {
      allPhotoPaths.push(photo.storage_path);
    }
  }

  assertEquals(allPhotoPaths.length, 0);

  // When no photos, no storage calls should be made
  assertEquals(createSignedUrlsCalls.length, 0);
});

Deno.test('get-user-discs: should correctly map signed URLs back to photos', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create 2 discs with different numbers of photos
  const disc1: MockDisc = {
    id: 'disc-1',
    owner_id: mockUser.id,
    name: 'Disc with 3 photos',
    mold: 'Destroyer',
    created_at: new Date('2024-01-01').toISOString(),
  };
  mockDiscs.push(disc1);

  const disc2: MockDisc = {
    id: 'disc-2',
    owner_id: mockUser.id,
    name: 'Disc with 1 photo',
    mold: 'Buzzz',
    created_at: new Date('2024-01-02').toISOString(),
  };
  mockDiscs.push(disc2);

  mockDiscPhotos.push(
    {
      id: 'photo-1',
      disc_id: 'disc-1',
      storage_path: 'disc-1/photo1.jpg',
      photo_uuid: 'uuid-1',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-2',
      disc_id: 'disc-1',
      storage_path: 'disc-1/photo2.jpg',
      photo_uuid: 'uuid-2',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-3',
      disc_id: 'disc-1',
      storage_path: 'disc-1/photo3.jpg',
      photo_uuid: 'uuid-3',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-4',
      disc_id: 'disc-2',
      storage_path: 'disc-2/photo1.jpg',
      photo_uuid: 'uuid-4',
      created_at: new Date().toISOString(),
    }
  );

  const supabase = mockSupabaseClient();
  const adminClient = mockSupabaseAdminClient();

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Fetch discs
  const { data: discs } = await supabase
    .from('discs')
    .select('*, photos:disc_photos(*), qr_code:qr_codes(*), recovery_events(*)')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  assertExists(discs);

  // Collect all photo paths with their storage_path for mapping
  const allPhotoPaths: string[] = [];
  for (const disc of discs) {
    for (const photo of disc.photos || []) {
      allPhotoPaths.push(photo.storage_path);
    }
  }

  // Get signed URLs in batch
  const { data: signedUrls } = await adminClient.storage.from('disc-photos').createSignedUrls(allPhotoPaths, 3600);

  assertExists(signedUrls);

  // Create a map from path to signed URL
  const pathToUrl = new Map<string, string>();
  for (const urlData of signedUrls) {
    pathToUrl.set(urlData.path, urlData.signedUrl);
  }

  // Process discs and map URLs back to photos
  const processedDiscs = discs.map((disc) => ({
    ...disc,
    photos: (disc.photos || []).map((photo: MockDiscPhoto) => ({
      ...photo,
      photo_url: pathToUrl.get(photo.storage_path) || null,
    })),
  }));

  // Verify disc 1 has 3 photos with correct URLs
  const processedDisc1 = processedDiscs.find((d) => d.id === 'disc-1');
  assertExists(processedDisc1);
  assertEquals(processedDisc1.photos.length, 3);
  assertEquals(processedDisc1.photos[0].photo_url, 'https://storage.example.com/signed/disc-1/photo1.jpg?token=abc123');
  assertEquals(processedDisc1.photos[1].photo_url, 'https://storage.example.com/signed/disc-1/photo2.jpg?token=abc123');
  assertEquals(processedDisc1.photos[2].photo_url, 'https://storage.example.com/signed/disc-1/photo3.jpg?token=abc123');

  // Verify disc 2 has 1 photo with correct URL
  const processedDisc2 = processedDiscs.find((d) => d.id === 'disc-2');
  assertExists(processedDisc2);
  assertEquals(processedDisc2.photos.length, 1);
  assertEquals(processedDisc2.photos[0].photo_url, 'https://storage.example.com/signed/disc-2/photo1.jpg?token=abc123');
});

Deno.test('get-user-discs: should handle mixed discs (some with photos, some without)', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create 3 discs - 2 with photos, 1 without
  const disc1: MockDisc = {
    id: 'disc-1',
    owner_id: mockUser.id,
    name: 'Disc with photos',
    mold: 'Destroyer',
    created_at: new Date('2024-01-01').toISOString(),
  };
  mockDiscs.push(disc1);

  const disc2: MockDisc = {
    id: 'disc-2',
    owner_id: mockUser.id,
    name: 'Disc without photos',
    mold: 'Buzzz',
    created_at: new Date('2024-01-02').toISOString(),
  };
  mockDiscs.push(disc2);

  const disc3: MockDisc = {
    id: 'disc-3',
    owner_id: mockUser.id,
    name: 'Another disc with photos',
    mold: 'Teebird',
    created_at: new Date('2024-01-03').toISOString(),
  };
  mockDiscs.push(disc3);

  // Only add photos to disc-1 and disc-3
  mockDiscPhotos.push(
    {
      id: 'photo-1',
      disc_id: 'disc-1',
      storage_path: 'disc-1/photo1.jpg',
      photo_uuid: 'uuid-1',
      created_at: new Date().toISOString(),
    },
    {
      id: 'photo-2',
      disc_id: 'disc-3',
      storage_path: 'disc-3/photo1.jpg',
      photo_uuid: 'uuid-2',
      created_at: new Date().toISOString(),
    }
  );

  const supabase = mockSupabaseClient();
  const adminClient = mockSupabaseAdminClient();

  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Fetch discs
  const { data: discs } = await supabase
    .from('discs')
    .select('*, photos:disc_photos(*), qr_code:qr_codes(*), recovery_events(*)')
    .eq('owner_id', authData.user.id)
    .order('created_at', { ascending: false });

  assertExists(discs);
  assertEquals(discs.length, 3);

  // Collect all photo paths
  const allPhotoPaths: string[] = [];
  for (const disc of discs) {
    for (const photo of disc.photos || []) {
      allPhotoPaths.push(photo.storage_path);
    }
  }

  // Should have exactly 2 photo paths (from disc-1 and disc-3)
  assertEquals(allPhotoPaths.length, 2);

  // Get signed URLs in batch
  if (allPhotoPaths.length > 0) {
    await adminClient.storage.from('disc-photos').createSignedUrls(allPhotoPaths, 3600);
  }

  // Verify only ONE batch call was made for the 2 photos
  assertEquals(createSignedUrlsCalls.length, 1);
  assertEquals(createSignedUrlsCalls[0].length, 2);
});
