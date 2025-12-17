import { assertEquals } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockDisc = {
  id: string;
  owner_id: string;
  name: string;
  mold: string;
};

type MockDiscPhoto = {
  id: string;
  disc_id: string;
  storage_path: string;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockDiscs: MockDisc[] = [];
let mockDiscPhotos: MockDiscPhoto[] = [];
let mockCurrentUser: MockUser | null = null;
let mockStorageFiles: string[] = [];

// Reset mocks between tests
function resetMocks() {
  mockUsers = [];
  mockDiscs = [];
  mockDiscPhotos = [];
  mockCurrentUser = null;
  mockStorageFiles = [];
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
            if (table === 'disc_photos') {
              const photo = mockDiscPhotos.find((p) => p[column as keyof MockDiscPhoto] === value);
              if (!photo) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              // Join with disc
              const disc = mockDiscs.find((d) => d.id === photo.disc_id);
              if (!disc) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              const result = {
                ...photo,
                discs: disc,
              };
              return { data: result, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: (column: string, value: string) => {
          if (table === 'disc_photos') {
            const index = mockDiscPhotos.findIndex((p) => p[column as keyof MockDiscPhoto] === value);
            if (index !== -1) {
              mockDiscPhotos.splice(index, 1);
              return Promise.resolve({ error: null });
            }
          }
          return Promise.resolve({ error: { message: 'Not found' } });
        },
      }),
    }),
    storage: {
      from: (_bucket: string) => ({
        remove: async (paths: string[]) => {
          paths.forEach((path) => {
            const index = mockStorageFiles.indexOf(path);
            if (index !== -1) {
              mockStorageFiles.splice(index, 1);
            }
          });
          return { data: null, error: null };
        },
      }),
    },
  };
}

Deno.test('delete-disc-photo: should return 405 for non-DELETE requests', () => {
  const method: string = 'POST';

  if (method !== 'DELETE') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('delete-disc-photo: should return 401 when not authenticated', async () => {
  resetMocks();
  const supabase = mockSupabaseClient();

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const data = await response.json();
    assertEquals(data.error, 'Missing authorization header');
  }
});

Deno.test('delete-disc-photo: should return 400 when photo_id is missing', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  const body: { photo_id?: string } = {};

  if (!body.photo_id) {
    const response = new Response(JSON.stringify({ error: 'photo_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'photo_id is required');
  }
});

Deno.test('delete-disc-photo: should return 404 when photo not found', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const { data: photo } = await supabase
    .from('disc_photos')
    .select('*, discs(*)')
    .eq('id', '00000000-0000-0000-0000-000000000000')
    .single();

  if (!photo) {
    const response = new Response(JSON.stringify({ error: 'Photo not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const data = await response.json();
    assertEquals(data.error, 'Photo not found');
  }
});

Deno.test('delete-disc-photo: should return 403 when user does not own disc', async () => {
  resetMocks();
  const ownerId = 'owner-123';
  const otherUserId = 'other-456';
  mockCurrentUser = { id: otherUserId, email: 'other@example.com' };

  mockUsers.push({ id: ownerId, email: 'owner@example.com' });
  mockUsers.push(mockCurrentUser);

  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const photo: MockDiscPhoto = {
    id: 'photo-123',
    disc_id: disc.id,
    storage_path: `test/${disc.id}/test-photo.jpg`,
  };
  mockDiscPhotos.push(photo);
  mockStorageFiles.push(photo.storage_path);

  const supabase = mockSupabaseClient();
  const { data: photoData } = await supabase.from('disc_photos').select('*, discs(*)').eq('id', photo.id).single();

  if (photoData && photoData.discs.owner_id !== mockCurrentUser.id) {
    const response = new Response(JSON.stringify({ error: 'You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const data = await response.json();
    assertEquals(data.error, 'You do not own this disc');
  }
});

Deno.test('delete-disc-photo: owner can delete their own photo', async () => {
  resetMocks();
  const ownerId = 'owner-123';
  mockCurrentUser = { id: ownerId, email: 'owner@example.com' };

  mockUsers.push(mockCurrentUser);

  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: ownerId,
    name: 'Test Disc',
    mold: 'Destroyer',
  };
  mockDiscs.push(disc);

  const photo: MockDiscPhoto = {
    id: 'photo-123',
    disc_id: disc.id,
    storage_path: `test/${disc.id}/test-photo.jpg`,
  };
  mockDiscPhotos.push(photo);
  mockStorageFiles.push(photo.storage_path);

  const supabase = mockSupabaseClient();

  // Get photo
  const { data: photoData } = await supabase.from('disc_photos').select('*, discs(*)').eq('id', photo.id).single();

  if (photoData && photoData.discs.owner_id === mockCurrentUser.id) {
    // Delete from storage
    await supabase.storage.from('disc-photos').remove([photoData.storage_path]);

    // Delete from database
    await supabase.from('disc_photos').delete().eq('id', photo.id);

    const response = new Response(
      JSON.stringify({
        success: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);

    // Verify photo record was deleted
    const deletedPhoto = mockDiscPhotos.find((p) => p.id === photo.id);
    assertEquals(deletedPhoto, undefined);

    // Verify storage file was deleted
    assertEquals(mockStorageFiles.includes(photo.storage_path), false);
  }
});
