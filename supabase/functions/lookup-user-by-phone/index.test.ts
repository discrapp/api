import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Mock data types
interface MockUser {
  id: string;
  email: string;
}

interface MockProfile {
  id: string;
  username: string;
  full_name: string | null;
  display_preference: string;
  phone_number: string | null;
  phone_discoverable: boolean;
}

interface MockDisc {
  id: string;
  name: string;
  manufacturer: string | null;
  mold: string | null;
  color: string | null;
  owner_id: string;
  disc_photos: Array<{ storage_path: string }>;
}

interface MockLookupLog {
  finder_id: string;
  searched_phone: string;
  normalized_phone: string;
  matched_user_id: string | null;
  was_discoverable: boolean | null;
}

// Mock state
let mockAuthUsers: MockUser[] = [];
let mockProfiles: MockProfile[] = [];
let mockDiscs: MockDisc[] = [];
let mockLookupLogs: MockLookupLog[] = [];

function resetMocks() {
  mockAuthUsers = [];
  mockProfiles = [];
  mockDiscs = [];
  mockLookupLogs = [];
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: mockAuthUsers[0] || null },
        error: mockAuthUsers[0] ? null : { message: 'No user' },
      }),
    },
  };
}

// Mock Supabase admin client
function mockSupabaseAdmin() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: async () => {
            if (table === 'profiles' && column === 'phone_number') {
              const profile = mockProfiles.find((p) => p.phone_number === value);
              return {
                data: profile || null,
                error: profile ? null : { code: 'PGRST116' },
              };
            }
            return { data: null, error: null };
          },
          order: (_col: string, _opts: { ascending: boolean }) => {
            if (table === 'discs' && column === 'owner_id') {
              const discs = mockDiscs.filter((d) => d.owner_id === value);
              return Promise.resolve({ data: discs, error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
      insert: (data: MockLookupLog) => {
        mockLookupLogs.push(data);
        return Promise.resolve({ error: null });
      },
    }),
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: async (path: string, _expiresIn: number) => ({
          data: { signedUrl: `https://storage.example.com/${path}?signed=true` },
          error: null,
        }),
      }),
    },
  };
}

Deno.test('lookup-user-by-phone: returns 405 for non-POST requests', async () => {
  const response = await mockHandler('GET', null, null);

  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error, 'Method not allowed');
});

Deno.test('lookup-user-by-phone: returns 401 without auth header', async () => {
  const response = await mockHandler('POST', null, { phone_number: '5125551234' });

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Missing authorization header');
});

Deno.test('lookup-user-by-phone: returns 401 for invalid user', async () => {
  resetMocks();
  // No user in mockAuthUsers = invalid auth

  const response = await mockHandler('POST', 'Bearer invalid-token', { phone_number: '5125551234' });

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Unauthorized');
});

Deno.test('lookup-user-by-phone: returns 400 when phone_number is missing', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });

  const response = await mockHandler('POST', 'Bearer valid-token', {});

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'phone_number is required');
});

Deno.test('lookup-user-by-phone: returns 400 for invalid phone format', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '123' });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Invalid phone number format');
});

Deno.test('lookup-user-by-phone: returns not found when no user matches', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.found, false);
  assertEquals(body.discoverable, false);
  assertEquals(body.message, 'No user found with this phone number');
});

Deno.test('lookup-user-by-phone: returns found but not discoverable', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: 'Disc Owner',
    display_preference: 'username',
    phone_number: '+15125551234',
    phone_discoverable: false, // Not discoverable
  });

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.found, true);
  assertEquals(body.discoverable, false);
  assertEquals(body.message, 'User found but has not enabled phone lookup');
});

Deno.test('lookup-user-by-phone: returns user and discs when discoverable', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: 'Disc Owner',
    display_preference: 'username',
    phone_number: '+15125551234',
    phone_discoverable: true,
  });
  mockDiscs.push({
    id: 'disc-1',
    name: 'My Destroyer',
    manufacturer: 'Innova',
    mold: 'Destroyer',
    color: 'Red',
    owner_id: 'owner-1',
    disc_photos: [{ storage_path: 'owner-1/disc-1.jpg' }],
  });

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '(512) 555-1234' });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.found, true);
  assertEquals(body.discoverable, true);
  assertExists(body.user);
  assertEquals(body.user.id, 'owner-1');
  assertEquals(body.user.display_name, 'discowner');
  assertEquals(body.user.disc_count, 1);
  assertExists(body.discs);
  assertEquals(body.discs.length, 1);
  assertEquals(body.discs[0].manufacturer, 'Innova');
  assertExists(body.discs[0].photo_url);
});

Deno.test('lookup-user-by-phone: uses full_name when display_preference is full_name', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: 'John Smith',
    display_preference: 'full_name',
    phone_number: '+15125551234',
    phone_discoverable: true,
  });

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.user.display_name, 'John Smith');
});

Deno.test('lookup-user-by-phone: logs lookup attempt', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: null,
    display_preference: 'username',
    phone_number: '+15125551234',
    phone_discoverable: true,
  });

  await mockHandler('POST', 'Bearer valid-token', { phone_number: '512-555-1234' });

  assertEquals(mockLookupLogs.length, 1);
  assertEquals(mockLookupLogs[0].finder_id, 'finder-1');
  assertEquals(mockLookupLogs[0].searched_phone, '512-555-1234');
  assertEquals(mockLookupLogs[0].normalized_phone, '+15125551234');
  assertEquals(mockLookupLogs[0].matched_user_id, 'owner-1');
  assertEquals(mockLookupLogs[0].was_discoverable, true);
});

Deno.test('lookup-user-by-phone: normalizes various phone formats', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: null,
    display_preference: 'username',
    phone_number: '+15125551234',
    phone_discoverable: true,
  });

  // Test different formats
  const formats = [
    '5125551234',
    '512-555-1234',
    '(512) 555-1234',
    '512.555.1234',
    '1-512-555-1234',
    '+1 512 555 1234',
  ];

  for (const format of formats) {
    resetMocks();
    mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
    mockProfiles.push({
      id: 'owner-1',
      username: 'discowner',
      full_name: null,
      display_preference: 'username',
      phone_number: '+15125551234',
      phone_discoverable: true,
    });

    const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: format });
    const body = await response.json();
    assertEquals(body.found, true, `Failed for format: ${format}`);
  }
});

Deno.test('lookup-user-by-phone: handles user with no discs', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'newuser',
    full_name: null,
    display_preference: 'username',
    phone_number: '+15125551234',
    phone_discoverable: true,
  });
  // No discs for this user

  const response = await mockHandler('POST', 'Bearer valid-token', { phone_number: '5125551234' });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.found, true);
  assertEquals(body.user.disc_count, 0);
  assertEquals(body.discs.length, 0);
});

// Phone number normalization helper
function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

function isValidPhoneNumber(phone: string): boolean {
  const normalized = normalizePhoneNumber(phone);
  return /^\+\d{10,15}$/.test(normalized);
}

// Mock handler that simulates the actual handler behavior
async function mockHandler(
  method: string,
  authHeader: string | null,
  body: Record<string, unknown> | null
): Promise<Response> {
  // Method check
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth check
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // User check
  const client = mockSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate phone_number
  if (!body?.phone_number || typeof body.phone_number !== 'string') {
    return new Response(JSON.stringify({ error: 'phone_number is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const normalizedPhone = normalizePhoneNumber(body.phone_number as string);

  if (!isValidPhoneNumber(body.phone_number as string)) {
    return new Response(JSON.stringify({ error: 'Invalid phone number format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = mockSupabaseAdmin();

  // Look up user
  const { data: matchedUser } = await admin
    .from('profiles')
    .select('id, username, full_name, display_preference, phone_discoverable')
    .eq('phone_number', normalizedPhone)
    .single();

  // Log the lookup
  await admin.from('phone_lookup_logs').insert({
    finder_id: data.user.id,
    searched_phone: body.phone_number as string,
    normalized_phone: normalizedPhone,
    matched_user_id: matchedUser?.id || null,
    was_discoverable: matchedUser?.phone_discoverable || null,
  });

  // No user found
  if (!matchedUser) {
    return new Response(
      JSON.stringify({
        found: false,
        discoverable: false,
        message: 'No user found with this phone number',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // User not discoverable
  if (!matchedUser.phone_discoverable) {
    return new Response(
      JSON.stringify({
        found: true,
        discoverable: false,
        message: 'User found but has not enabled phone lookup',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Get user's discs
  const { data: discs } = await admin
    .from('discs')
    .select('id, name, manufacturer, mold, color, disc_photos(storage_path)')
    .eq('owner_id', matchedUser.id)
    .order('created_at', { ascending: false });

  // Generate signed URLs
  const discsWithPhotos = await Promise.all(
    (discs || []).map(async (disc: MockDisc) => {
      let photoUrl: string | null = null;
      if (disc.disc_photos && disc.disc_photos.length > 0) {
        const { data: signedUrl } = await admin.storage
          .from('disc-photos')
          .createSignedUrl(disc.disc_photos[0].storage_path, 3600);
        photoUrl = signedUrl?.signedUrl || null;
      }
      return {
        id: disc.id,
        name: disc.name,
        manufacturer: disc.manufacturer,
        mold: disc.mold,
        color: disc.color,
        photo_url: photoUrl,
      };
    })
  );

  // Determine display name
  let displayName = matchedUser.username;
  if (matchedUser.display_preference === 'full_name' && matchedUser.full_name) {
    displayName = matchedUser.full_name;
  }

  return new Response(
    JSON.stringify({
      found: true,
      discoverable: true,
      user: {
        id: matchedUser.id,
        display_name: displayName,
        disc_count: discsWithPhotos.length,
      },
      discs: discsWithPhotos,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
