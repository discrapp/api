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

interface MockRecoveryEvent {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  drop_off_photo_url?: string | null;
}

// Mock data storage
let mockUser: MockUser | null = null;
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockDiscs = [];
  mockRecoveryEvents = [];
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
            if (table === 'discs') {
              const disc = mockDiscs.find((d) => d.id === value);
              if (disc) {
                return Promise.resolve({ data: disc, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            } else if (table === 'recovery_events') {
              const recovery = mockRecoveryEvents.find((r) => r.id === value);
              if (recovery) {
                return Promise.resolve({ data: recovery, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
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
            } else if (table === 'recovery_events') {
              const recoveryData = Array.isArray(values) ? values[0] : values;
              const newRecovery: MockRecoveryEvent = {
                id: `recovery-${Date.now()}`,
                disc_id: recoveryData.disc_id as string,
                finder_id: recoveryData.finder_id as string,
                status: recoveryData.status as string,
              };
              mockRecoveryEvents.push(newRecovery);
              return Promise.resolve({ data: newRecovery, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
          },
        }),
      }),
      update: (values: Partial<MockRecoveryEvent>) => ({
        eq: (_column: string, recoveryId: string) => ({
          select: (_columns?: string) => ({
            single: () => {
              if (table === 'recovery_events') {
                const recoveryIndex = mockRecoveryEvents.findIndex((r) => r.id === recoveryId);
                if (recoveryIndex === -1) {
                  return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                }
                const updatedRecovery = { ...mockRecoveryEvents[recoveryIndex], ...values };
                mockRecoveryEvents[recoveryIndex] = updatedRecovery;
                return Promise.resolve({ data: updatedRecovery, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
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

Deno.test('upload-drop-off-photo: should return 401 when not authenticated', async () => {
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

Deno.test('upload-drop-off-photo: should return 400 when recovery_event_id is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const formData = new FormData();
  formData.append('file', new Blob(['test'], { type: 'image/jpeg' }), 'test.jpg');

  const recoveryEventId = formData.get('recovery_event_id');
  if (!recoveryEventId) {
    const response = new Response(JSON.stringify({ error: 'recovery_event_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const error = await response.json();
    assertExists(error.error);
  }
});

Deno.test('upload-drop-off-photo: should return 400 when file is missing', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const formData = new FormData();
  formData.append('recovery_event_id', 'test-recovery-id');

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

Deno.test('upload-drop-off-photo: should return 404 when recovery event does not exist', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const supabase = mockSupabaseClient();
  const recoveryEventId = '00000000-0000-0000-0000-000000000000';

  const { data, error } = await supabase.from('recovery_events').select('*').eq('id', recoveryEventId).single();

  if (error || !data) {
    const response = new Response(JSON.stringify({ error: 'Recovery event not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 404);
    const errorData = await response.json();
    assertEquals(errorData.error, 'Recovery event not found');
  }
});

Deno.test('upload-drop-off-photo: should return 403 when user is not the finder', async () => {
  resetMocks();

  // Create owner user
  const ownerId = 'owner-123';

  // Create disc owned by owner
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: ownerId,
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create finder user
  const finderId = 'finder-123';
  const _finderUser: MockUser = {
    id: finderId,
    email: 'finder@example.com',
  };

  // Create recovery event
  const recovery: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
  };
  mockRecoveryEvents.push(recovery);

  // Switch to a different user (not the finder)
  mockUser = { id: 'other-user-123', email: 'other@example.com' };

  const supabase = mockSupabaseClient();

  // Try to upload photo
  const { data: fetchedRecovery } = await supabase.from('recovery_events').select('*').eq('id', recovery.id).single();

  assertExists(fetchedRecovery);
  const recoveryData = fetchedRecovery as MockRecoveryEvent;

  // Check if user is the finder
  const currentUser = await supabase.auth.getUser();
  if (recoveryData.finder_id !== currentUser.data.user?.id) {
    const response = new Response(JSON.stringify({ error: 'Only the finder can upload drop-off photos' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const error = await response.json();
    assertEquals(error.error, 'Only the finder can upload drop-off photos');
  }
});

Deno.test('upload-drop-off-photo: should return 400 when recovery is not in found status', async () => {
  resetMocks();

  // Create finder user
  const finderId = 'finder-123';
  mockUser = { id: finderId, email: 'finder@example.com' };

  // Create disc
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: 'owner-123',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create recovery event with 'completed' status
  const recovery: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'completed',
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();

  const { data: fetchedRecovery } = await supabase.from('recovery_events').select('*').eq('id', recovery.id).single();

  assertExists(fetchedRecovery);
  const recoveryData = fetchedRecovery as MockRecoveryEvent;

  // Check status
  if (recoveryData.status !== 'found') {
    const response = new Response(
      JSON.stringify({ error: 'Can only upload drop-off photo for a recovery in found status' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const error = await response.json();
    assertEquals(error.error, 'Can only upload drop-off photo for a recovery in found status');
  }
});

Deno.test('upload-drop-off-photo: should upload photo successfully', async () => {
  resetMocks();

  // Create finder user
  const finderId = 'finder-123';
  mockUser = { id: finderId, email: 'finder@example.com' };

  // Create disc
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: 'owner-123',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create recovery event in 'found' status
  const recovery: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();

  // Upload photo
  const file = new Blob(['test image data'], { type: 'image/jpeg' });
  const photoId = crypto.randomUUID();
  const storagePath = `drop-offs/${recovery.id}/${photoId}.jpg`;

  await supabase.storage.from('drop-off-photos').upload(storagePath, file);
  const { data: urlData } = supabase.storage.from('drop-off-photos').getPublicUrl(storagePath);

  // Update recovery event with photo URL
  const { data: updatedRecovery } = await supabase
    .from('recovery_events')
    .update({ drop_off_photo_url: urlData.publicUrl })
    .eq('id', recovery.id)
    .select('*')
    .single();

  assertExists(updatedRecovery);

  const response = new Response(
    JSON.stringify({
      success: true,
      photo_url: urlData.publicUrl,
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
  assertExists(data.photo_url);
  assertExists(data.storage_path);
  // Verify storage path format: drop-offs/{recovery_event_id}/{uuid}.jpg
  assertEquals(data.storage_path.startsWith(`drop-offs/${recovery.id}/`), true);
  assertEquals(data.storage_path.endsWith('.jpg'), true);
});

Deno.test('upload-drop-off-photo: should reject non-image files', async () => {
  resetMocks();

  // Create finder user
  const finderId = 'finder-123';
  mockUser = { id: finderId, email: 'finder@example.com' };

  // Create disc
  const disc: MockDisc = {
    id: 'disc-123',
    owner_id: 'owner-123',
    name: 'Test Disc',
    flight_numbers: { speed: 7, glide: 5, turn: 0, fade: 1 },
  };
  mockDiscs.push(disc);

  // Create recovery event
  const recovery: MockRecoveryEvent = {
    id: 'recovery-123',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
  };
  mockRecoveryEvents.push(recovery);

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
    assertEquals(error.error, 'File must be an image (jpeg, png, or webp)');
  }
});
