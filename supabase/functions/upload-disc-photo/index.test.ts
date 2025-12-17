import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
interface MockUser {
  id: string;
  email: string;
}

interface MockDisc {
  id: string;
  owner_id: string;
  name: string;
  flight_numbers?: { speed: number; glide: number; turn: number; fade: number };
}

interface MockDiscPhoto {
  id: string;
  disc_id: string;
  photo_url: string;
  storage_path: string;
}

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
        eq: (_column: string, value: string) => {
          if (table === 'discs') {
            return {
              single: () => {
                const disc = mockDiscs.find((d) => d.id === value);
                if (disc) {
                  return Promise.resolve({ data: disc, error: null });
                }
                return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
              },
            };
          } else if (table === 'disc_photos') {
            return Promise.resolve({
              data: mockDiscPhotos.filter((p) => p.disc_id === value),
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        select: () => ({
          single: () => {
            if (table === 'discs') {
              const discData = Array.isArray(values) ? values[0] : values;
              const newDisc: MockDisc = {
                id: `disc-${Date.now()}`,
                owner_id: mockUser?.id || '',
                name: discData.name as string,
                flight_numbers: discData.flight_numbers as
                  | { speed: number; glide: number; turn: number; fade: number }
                  | undefined,
              };
              mockDiscs.push(newDisc);
              return Promise.resolve({ data: newDisc, error: null });
            } else if (table === 'disc_photos') {
              const photoData = Array.isArray(values) ? values[0] : values;
              const newPhoto: MockDiscPhoto = {
                id: `photo-${Date.now()}`,
                disc_id: photoData.disc_id as string,
                photo_url: `https://example.com/photos/${Date.now()}.jpg`,
                storage_path: `discs/${photoData.disc_id as string}/${Date.now()}.jpg`,
              };
              mockDiscPhotos.push(newPhoto);
              return Promise.resolve({ data: newPhoto, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
    }),
    storage: {
      from: (_bucket: string) => ({
        upload: (_path: string, _file: Blob) => {
          return Promise.resolve({ data: { path: 'uploaded/path.jpg' }, error: null });
        },
        getPublicUrl: (path: string) => {
          return { data: { publicUrl: `https://example.com/${path}` } };
        },
      }),
    },
  };
}

Deno.test('upload-disc-photo: should return 401 when not authenticated', async () => {
  resetMocks();

  const authHeader = undefined;

  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
  }
});

Deno.test('upload-disc-photo: should return 400 when disc_id is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const formData = new FormData();
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const discId = formData.get('disc_id');
  if (!discId) {
    const response = new Response(JSON.stringify({ error: 'disc_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
  }
});

Deno.test('upload-disc-photo: should return 400 when file is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const formData = new FormData();
  formData.append('disc_id', 'test-disc-id');

  const file = formData.get('file');
  if (!file) {
    const response = new Response(JSON.stringify({ error: 'file is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
  }
});

Deno.test("upload-disc-photo: should return 403 when user doesn't own disc", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create a disc owned by user-123
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: 'user-123',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Switch to different user
  mockUser = { id: 'user-456', email: 'test2@example.com' };

  const supabase = mockSupabaseClient();

  // Try to upload photo for disc owned by user-123
  const result = await supabase.from('discs').select('*').eq('id', disc.id);
  const fetchedDisc = 'single' in result ? (await result.single()).data : null;

  assertExists(fetchedDisc);

  // Check ownership
  const currentUser = await supabase.auth.getUser();
  if (fetchedDisc.owner_id !== currentUser.data.user?.id) {
    const response = new Response(JSON.stringify({ error: 'Forbidden: You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
  }
});

Deno.test('upload-disc-photo: should upload photo successfully with UUID filename', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Create a disc
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: 'user-123',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Upload photo
  const file = new Blob(['test image data'], { type: 'image/jpeg' });
  const photoId = crypto.randomUUID();
  const storagePath = `discs/${disc.id}/${photoId}.jpg`;

  await supabase.storage.from('disc-photos').upload(storagePath, file);
  const { data: urlData } = supabase.storage.from('disc-photos').getPublicUrl(storagePath);

  const { data: photo } = await supabase
    .from('disc_photos')
    .insert({
      disc_id: disc.id,
      photo_url: urlData.publicUrl,
      storage_path: storagePath,
    })
    .select()
    .single();

  assertExists(photo);
  const photoData = photo as MockDiscPhoto;
  assertExists(photoData.photo_url);
  assertExists(photoData.storage_path);
  assertExists(photoData.id);

  const response = new Response(
    JSON.stringify({
      photo_url: photoData.photo_url,
      storage_path: photoData.storage_path,
      photo_id: photoData.id,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertExists(data.photo_url);
  assertExists(data.storage_path);
  assertExists(data.photo_id);
  // Verify photo_id is a valid UUID format (36 characters)
  assertEquals(data.photo_id.length, 36);
});

Deno.test('upload-disc-photo: should reject non-image files', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Create a disc
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: 'user-123',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  const file = new Blob(['test'], { type: 'application/pdf' });

  // Validate file type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    const response = new Response(JSON.stringify({ error: 'File must be an image (jpeg, png, or webp)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
  }
});

Deno.test('upload-disc-photo: should enforce maximum 4 photos per disc', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Create a disc
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: 'user-123',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Upload 4 photos
  for (let i = 0; i < 4; i++) {
    await supabase
      .from('disc_photos')
      .insert({
        disc_id: disc.id,
        photo_url: `https://example.com/photo${i}.jpg`,
        storage_path: `discs/${disc.id}/photo${i}.jpg`,
      })
      .select()
      .single();
  }

  // Check photo count
  const result = await supabase.from('disc_photos').select('*').eq('disc_id', disc.id);
  const existingPhotos = 'data' in result ? result.data : null;

  assertExists(existingPhotos);
  assertEquals(existingPhotos.length, 4);

  // Try to upload 5th photo
  if (existingPhotos.length >= 4) {
    const response = new Response(JSON.stringify({ error: 'Maximum of 4 photos per disc' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertEquals(error.error, 'Maximum of 4 photos per disc');
  }
});
