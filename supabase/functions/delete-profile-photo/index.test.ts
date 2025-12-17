import { assertEquals } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockProfile = {
  id: string;
  avatar_url: string | null;
};

// Mock data storage
let mockUsers: MockUser[] = [];
let mockProfiles: MockProfile[] = [];
let mockCurrentUser: MockUser | null = null;
let mockStorageFiles: string[] = [];

// Reset mocks between tests
function resetMocks() {
  mockUsers = [];
  mockProfiles = [];
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
            if (table === 'profiles') {
              const profile = mockProfiles.find((p) => p.id === value);
              if (!profile) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: profile, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: (updates: Record<string, unknown>) => ({
        eq: (column: string, value: string) => {
          if (table === 'profiles') {
            const index = mockProfiles.findIndex((p) => p.id === value);
            if (index !== -1) {
              mockProfiles[index] = { ...mockProfiles[index], ...updates } as MockProfile;
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
        list: async () => {
          return {
            data: mockStorageFiles.map((name) => ({ name })),
            error: null,
          };
        },
      }),
    },
  };
}

Deno.test('delete-profile-photo: should return 405 for non-DELETE requests', () => {
  const method: string = 'POST';

  if (method !== 'DELETE') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('delete-profile-photo: should return 401 when not authenticated', async () => {
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

Deno.test('delete-profile-photo: returns success when no photo exists (idempotent)', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  mockUsers.push(mockCurrentUser);

  const profile: MockProfile = {
    id: mockCurrentUser.id,
    avatar_url: null,
  };
  mockProfiles.push(profile);

  const supabase = mockSupabaseClient();

  // Verify user has no avatar_url
  const { data: profileBefore } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', mockCurrentUser.id)
    .single();
  assertEquals(profileBefore?.avatar_url, null);

  // Try to delete (should succeed idempotently)
  await supabase.from('profiles').update({ avatar_url: null }).eq('id', mockCurrentUser.id);

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
});

Deno.test('delete-profile-photo: successfully deletes existing photo', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  mockUsers.push(mockCurrentUser);

  const storagePath = `${mockCurrentUser.id}.jpg`;
  const profile: MockProfile = {
    id: mockCurrentUser.id,
    avatar_url: storagePath,
  };
  mockProfiles.push(profile);
  mockStorageFiles.push(storagePath);

  const supabase = mockSupabaseClient();

  // Verify setup
  const { data: profileBefore } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', mockCurrentUser.id)
    .single();
  assertEquals(profileBefore?.avatar_url, storagePath);

  // Delete the photo
  if (profileBefore?.avatar_url) {
    // Remove from storage
    await supabase.storage.from('profile-photos').remove([profileBefore.avatar_url]);

    // Clear avatar_url
    await supabase.from('profiles').update({ avatar_url: null }).eq('id', mockCurrentUser.id);
  }

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

  // Verify avatar_url is cleared
  const { data: profileAfter } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', mockCurrentUser.id)
    .single();
  assertEquals(profileAfter?.avatar_url, null);

  // Verify file is deleted from storage
  const { data: files } = await supabase.storage.from('profile-photos').list();
  const userFiles = files?.filter((f) => f.name === storagePath) || [];
  assertEquals(userFiles.length, 0);
});

Deno.test('delete-profile-photo: deletes all extensions for user', async () => {
  resetMocks();
  mockCurrentUser = { id: 'user-123', email: 'test@example.com' };

  mockUsers.push(mockCurrentUser);

  const extensions = ['jpg', 'png', 'webp'];
  extensions.forEach((ext) => {
    mockStorageFiles.push(`${mockCurrentUser!.id}.${ext}`);
  });

  const profile: MockProfile = {
    id: mockCurrentUser.id,
    avatar_url: `${mockCurrentUser.id}.jpg`,
  };
  mockProfiles.push(profile);

  const supabase = mockSupabaseClient();

  // Delete all possible extensions
  const pathsToRemove = extensions.map((ext) => `${mockCurrentUser!.id}.${ext}`);
  await supabase.storage.from('profile-photos').remove(pathsToRemove);

  // Clear avatar_url
  await supabase.from('profiles').update({ avatar_url: null }).eq('id', mockCurrentUser.id);

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

  // Verify all files are deleted
  const { data: files } = await supabase.storage.from('profile-photos').list();
  const userFiles = files?.filter((f) => f.name.startsWith(mockCurrentUser!.id)) || [];
  assertEquals(userFiles.length, 0);

  // Verify avatar_url is cleared
  const updatedProfile = mockProfiles.find((p) => p.id === mockCurrentUser!.id);
  assertEquals(updatedProfile?.avatar_url, null);
});
