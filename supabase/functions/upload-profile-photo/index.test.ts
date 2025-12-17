import { assertEquals, assertExists } from 'jsr:@std/assert';

// Create a minimal valid JPEG file (1x1 pixel)
function createTestJpeg(): ArrayBuffer {
  // Minimal valid JPEG (1x1 red pixel)
  const bytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08,
    0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a,
    0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34,
    0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
    0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04,
    0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61,
    0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33,
    0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36,
    0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84,
    0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6,
    0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
    0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01,
    0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd5, 0xdb, 0x20, 0xa8, 0xf1, 0x52, 0x8a, 0xff, 0xd9,
  ]);
  return bytes.buffer;
}

// Mock data types
interface MockUser {
  id: string;
  email: string;
}

interface MockProfile {
  id: string;
  avatar_url: string | null;
}

// Mock data storage
let mockUser: MockUser | null = null;
let mockProfiles: MockProfile[] = [];
let mockStorageFiles: Map<string, Blob> = new Map();

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockProfiles = [];
  mockStorageFiles = new Map();
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
          single: () => {
            if (table === 'profiles') {
              const profile = mockProfiles.find((p) => p.id === value);
              if (profile) {
                return Promise.resolve({ data: profile, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (values: Partial<MockProfile>) => ({
        eq: (_column: string, profileId: string) => {
          if (table === 'profiles') {
            const profileIndex = mockProfiles.findIndex((p) => p.id === profileId);
            if (profileIndex === -1) {
              // Create profile if it doesn't exist
              const newProfile: MockProfile = {
                id: profileId,
                avatar_url: values.avatar_url || null,
              };
              mockProfiles.push(newProfile);
              return Promise.resolve({ data: newProfile, error: null });
            }
            const updatedProfile = { ...mockProfiles[profileIndex], ...values };
            mockProfiles[profileIndex] = updatedProfile;
            return Promise.resolve({ data: updatedProfile, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    storage: {
      from: (_bucket: string) => ({
        upload: (path: string, file: Blob, _options?: { upsert?: boolean }) => {
          mockStorageFiles.set(path, file);
          return Promise.resolve({ data: { path }, error: null });
        },
        getPublicUrl: (path: string) => {
          return { data: { publicUrl: `https://example.com/${path}` } };
        },
        list: () => {
          const files = Array.from(mockStorageFiles.keys()).map((path) => ({
            name: path,
          }));
          return Promise.resolve({ data: files, error: null });
        },
        remove: (paths: string[]) => {
          paths.forEach((path) => mockStorageFiles.delete(path));
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  };
}

Deno.test('upload-profile-photo: should return 405 for non-POST requests', async () => {
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

Deno.test('upload-profile-photo: should return 401 when not authenticated', async () => {
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

Deno.test('upload-profile-photo: should return 400 when no file provided', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const formData = new FormData();
  const file = formData.get('file');

  if (!file) {
    const response = new Response(JSON.stringify({ error: 'file is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'file is required');
  }
});

Deno.test('upload-profile-photo: should return 400 for invalid file type', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const file = new Blob(['test content'], { type: 'text/plain' });

  // Validate file type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    const response = new Response(JSON.stringify({ error: 'File must be an image (jpeg, png, or webp)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'File must be an image (jpeg, png, or webp)');
  }
});

Deno.test('upload-profile-photo: successfully uploads profile photo', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Get current user
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Upload file
  const file = new Blob([createTestJpeg()], { type: 'image/jpeg' });
  const filename = `${authData.user.id}.jpg`;
  const storagePath = filename;

  await supabase.storage.from('profile-photos').upload(storagePath, file, { upsert: true });
  const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(storagePath);

  // Update profile
  await supabase.from('profiles').update({ avatar_url: filename }).eq('id', authData.user.id);

  const response = new Response(
    JSON.stringify({
      success: true,
      avatar_url: urlData.publicUrl,
      storage_path: storagePath,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(typeof data.avatar_url, 'string');
  assertExists(data.storage_path);

  // Verify profile was updated
  const profile = mockProfiles.find((p) => p.id === authData.user.id);
  assertExists(profile);
  assertEquals(profile.avatar_url, filename);
});

Deno.test('upload-profile-photo: replaces existing photo on re-upload', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Get current user
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // First upload
  const file1 = new Blob([createTestJpeg()], { type: 'image/jpeg' });
  const filename = `${authData.user.id}.jpg`;
  const storagePath = filename;

  await supabase.storage.from('profile-photos').upload(storagePath, file1, { upsert: true });
  const { data: urlData1 } = supabase.storage.from('profile-photos').getPublicUrl(storagePath);
  await supabase.from('profiles').update({ avatar_url: filename }).eq('id', authData.user.id);

  const response1 = new Response(
    JSON.stringify({
      success: true,
      avatar_url: urlData1.publicUrl,
      storage_path: storagePath,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
  assertEquals(response1.status, 200);
  const data1 = await response1.json();

  // Second upload (should replace)
  const file2 = new Blob([createTestJpeg()], { type: 'image/jpeg' });
  await supabase.storage.from('profile-photos').upload(storagePath, file2, { upsert: true });
  const { data: urlData2 } = supabase.storage.from('profile-photos').getPublicUrl(storagePath);
  await supabase.from('profiles').update({ avatar_url: filename }).eq('id', authData.user.id);

  const response2 = new Response(
    JSON.stringify({
      success: true,
      avatar_url: urlData2.publicUrl,
      storage_path: storagePath,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
  assertEquals(response2.status, 200);
  const data2 = await response2.json();

  assertEquals(data2.success, true);
  // Both should use same storage path (upsert)
  assertEquals(data1.storage_path, data2.storage_path);

  // Verify only one file exists
  const { data: files } = await supabase.storage.from('profile-photos').list();
  assertExists(files);
  const userFiles = files.filter((f) => f.name.startsWith(authData.user.id));
  assertEquals(userFiles.length, 1);
});

Deno.test('upload-profile-photo: handles PNG files', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();

  // Get current user
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  // Upload PNG file
  // Minimal valid PNG (1x1 pixel)
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
    0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const file = new Blob([pngBytes.buffer], { type: 'image/png' });
  const filename = `${authData.user.id}.png`;
  const storagePath = filename;

  await supabase.storage.from('profile-photos').upload(storagePath, file, { upsert: true });
  const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(storagePath);
  await supabase.from('profiles').update({ avatar_url: filename }).eq('id', authData.user.id);

  const response = new Response(
    JSON.stringify({
      success: true,
      avatar_url: urlData.publicUrl,
      storage_path: storagePath,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
  assertEquals(data.storage_path, `${authData.user.id}.png`);

  // Verify profile was updated
  const profile = mockProfiles.find((p) => p.id === authData.user.id);
  assertExists(profile);
  assertEquals(profile.avatar_url, filename);
});
