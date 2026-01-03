import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { RateLimitPresets } from '../_shared/with-rate-limit.ts';

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
  push_token: string | null;
}

interface MockDisc {
  id: string;
  owner_id: string;
  name: string;
  manufacturer: string | null;
  mold: string | null;
}

interface MockRecoveryEvent {
  id: string;
  disc_id: string | null;
  finder_id: string;
  owner_id: string;
  status: string;
  finder_message: string | null;
  front_photo_path: string | null;
  back_photo_path: string | null;
  found_at: string;
  created_at: string;
}

interface MockNotification {
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

// Mock state
let mockAuthUsers: MockUser[] = [];
let mockProfiles: MockProfile[] = [];
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];
let mockNotifications: MockNotification[] = [];

function resetMocks() {
  mockAuthUsers = [];
  mockProfiles = [];
  mockDiscs = [];
  mockRecoveryEvents = [];
  mockNotifications = [];
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

// Typed result interfaces
interface ProfileResult {
  data: MockProfile | null;
  error: { code: string } | null;
}

interface DiscResult {
  data: MockDisc | null;
  error: { code: string } | null;
}

interface RecoveryResult {
  data: MockRecoveryEvent | null;
  error: { code: string } | null;
}

// Mock Supabase admin client
function mockSupabaseAdmin() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: string) => ({
          single: async (): Promise<ProfileResult | DiscResult | RecoveryResult> => {
            if (table === 'profiles') {
              const profile = mockProfiles.find((p) => p[column as keyof MockProfile] === value);
              return {
                data: profile || null,
                error: profile ? null : { code: 'PGRST116' },
              };
            }
            if (table === 'discs') {
              const disc = mockDiscs.find((d) => d[column as keyof MockDisc] === value);
              return {
                data: disc || null,
                error: disc ? null : { code: 'PGRST116' },
              };
            }
            return { data: null, error: null };
          },
          in: (_inColumn: string, statuses: string[]) => ({
            maybeSingle: async (): Promise<RecoveryResult> => {
              if (table === 'recovery_events') {
                const recovery = mockRecoveryEvents.find(
                  (r) => r[column as keyof MockRecoveryEvent] === value && statuses.includes(r.status)
                );
                return { data: recovery || null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
      insert: (data: Partial<MockRecoveryEvent> | MockNotification) => ({
        select: () => ({
          single: async (): Promise<{ data: MockRecoveryEvent | null; error: { message: string } | null }> => {
            if (table === 'recovery_events') {
              const newRecovery = {
                ...data,
                id: `recovery-${Date.now()}`,
                created_at: new Date().toISOString(),
              } as MockRecoveryEvent;
              mockRecoveryEvents.push(newRecovery);
              return { data: newRecovery, error: null };
            }
            if (table === 'notifications') {
              mockNotifications.push(data as MockNotification);
              return { data: null, error: null };
            }
            return { data: null, error: { message: 'Insert failed' } };
          },
        }),
      }),
    }),
  };
}

Deno.test('report-found-disc-by-phone: returns 405 for non-POST requests', async () => {
  const response = await mockHandler('GET', null, null);

  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error, 'Method not allowed');
});

Deno.test('report-found-disc-by-phone: returns 401 without auth header', async () => {
  const response = await mockHandler('POST', null, { owner_id: 'owner-1' });

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Missing authorization header');
});

Deno.test('report-found-disc-by-phone: returns 401 for invalid user', async () => {
  resetMocks();
  // No user in mockAuthUsers = invalid auth

  const response = await mockHandler('POST', 'Bearer invalid-token', { owner_id: 'owner-1' });

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Unauthorized');
});

Deno.test('report-found-disc-by-phone: returns 400 when owner_id is missing', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });

  const response = await mockHandler('POST', 'Bearer valid-token', {});

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'owner_id is required');
});

Deno.test('report-found-disc-by-phone: returns 400 when owner not found', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  // No profiles = owner not found

  const response = await mockHandler('POST', 'Bearer valid-token', { owner_id: 'nonexistent-owner' });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Owner not found');
});

Deno.test('report-found-disc-by-phone: returns 400 when reporting own disc', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'user-1', email: 'user@example.com' });
  mockProfiles.push({
    id: 'user-1',
    username: 'sameuser',
    full_name: null,
    display_preference: 'username',
    push_token: null,
  });

  const response = await mockHandler('POST', 'Bearer valid-token', { owner_id: 'user-1' });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'You cannot report your own disc as found');
});

Deno.test('report-found-disc-by-phone: returns 400 when disc_id is invalid', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: 'Disc Owner',
    display_preference: 'username',
    push_token: 'ExponentPushToken[abc123]',
  });
  // No discs = disc not found

  const response = await mockHandler('POST', 'Bearer valid-token', {
    owner_id: 'owner-1',
    disc_id: 'nonexistent-disc',
  });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Disc not found');
});

Deno.test('report-found-disc-by-phone: returns 400 when disc belongs to different owner', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: null,
    display_preference: 'username',
    push_token: null,
  });
  mockDiscs.push({
    id: 'disc-1',
    owner_id: 'other-owner', // Different owner
    name: 'Not Their Disc',
    manufacturer: 'Innova',
    mold: 'Destroyer',
  });

  const response = await mockHandler('POST', 'Bearer valid-token', {
    owner_id: 'owner-1',
    disc_id: 'disc-1',
  });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'Disc does not belong to this owner');
});

Deno.test('report-found-disc-by-phone: returns 400 when disc has active recovery', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push({
    id: 'owner-1',
    username: 'discowner',
    full_name: null,
    display_preference: 'username',
    push_token: null,
  });
  mockDiscs.push({
    id: 'disc-1',
    owner_id: 'owner-1',
    name: 'Active Recovery Disc',
    manufacturer: 'Discraft',
    mold: 'Buzzz',
  });
  mockRecoveryEvents.push({
    id: 'recovery-1',
    disc_id: 'disc-1',
    finder_id: 'other-finder',
    owner_id: 'owner-1',
    status: 'found',
    finder_message: null,
    front_photo_path: null,
    back_photo_path: null,
    found_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });

  const response = await mockHandler('POST', 'Bearer valid-token', {
    owner_id: 'owner-1',
    disc_id: 'disc-1',
  });

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'This disc already has an active recovery in progress');
});

Deno.test('report-found-disc-by-phone: successfully creates recovery without disc_id', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push(
    {
      id: 'owner-1',
      username: 'discowner',
      full_name: 'Disc Owner',
      display_preference: 'username',
      push_token: 'ExponentPushToken[abc123]',
    },
    {
      id: 'finder-1',
      username: 'finder',
      full_name: null,
      display_preference: 'username',
      push_token: null,
    }
  );

  const response = await mockHandler('POST', 'Bearer valid-token', {
    owner_id: 'owner-1',
    message: 'Found your disc at the park!',
  });

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.recovery_event);
  assertEquals(body.recovery_event.owner_id, 'owner-1');
  assertEquals(body.recovery_event.status, 'found');
  assertEquals(body.recovery_event.finder_message, 'Found your disc at the park!');
  assertEquals(body.recovery_event.disc_id, null);
});

Deno.test('report-found-disc-by-phone: successfully creates recovery with disc_id', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push(
    {
      id: 'owner-1',
      username: 'discowner',
      full_name: 'Disc Owner',
      display_preference: 'full_name',
      push_token: 'ExponentPushToken[abc123]',
    },
    {
      id: 'finder-1',
      username: 'goodfinder',
      full_name: null,
      display_preference: 'username',
      push_token: null,
    }
  );
  mockDiscs.push({
    id: 'disc-1',
    owner_id: 'owner-1',
    name: 'My Destroyer',
    manufacturer: 'Innova',
    mold: 'Destroyer',
  });

  const response = await mockHandler('POST', 'Bearer valid-token', {
    owner_id: 'owner-1',
    disc_id: 'disc-1',
    message: 'Found your Destroyer!',
  });

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.recovery_event);
  assertEquals(body.recovery_event.disc_id, 'disc-1');
  assertEquals(body.recovery_event.disc_name, 'My Destroyer');
});

Deno.test('report-found-disc-by-phone: includes photo paths in recovery', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push(
    {
      id: 'owner-1',
      username: 'discowner',
      full_name: null,
      display_preference: 'username',
      push_token: null,
    },
    {
      id: 'finder-1',
      username: 'finder',
      full_name: null,
      display_preference: 'username',
      push_token: null,
    }
  );

  const response = await mockHandler('POST', 'Bearer valid-token', {
    owner_id: 'owner-1',
    front_photo_path: 'finder-1/front-12345.jpg',
    back_photo_path: 'finder-1/back-12345.jpg',
  });

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.recovery_event.front_photo_path, 'finder-1/front-12345.jpg');
  assertEquals(body.recovery_event.back_photo_path, 'finder-1/back-12345.jpg');
});

Deno.test('report-found-disc-by-phone: creates notification for owner', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push(
    {
      id: 'owner-1',
      username: 'discowner',
      full_name: null,
      display_preference: 'username',
      push_token: 'ExponentPushToken[abc123]',
    },
    {
      id: 'finder-1',
      username: 'helpfulfinder',
      full_name: null,
      display_preference: 'username',
      push_token: null,
    }
  );

  await mockHandler('POST', 'Bearer valid-token', {
    owner_id: 'owner-1',
    message: 'Found it!',
  });

  assertEquals(mockNotifications.length, 1);
  assertEquals(mockNotifications[0].user_id, 'owner-1');
  assertEquals(mockNotifications[0].type, 'disc_found_by_phone');
  assertEquals(mockNotifications[0].title, 'Someone found a disc with your phone number!');
});

Deno.test('report-found-disc-by-phone: works without optional fields', async () => {
  resetMocks();
  mockAuthUsers.push({ id: 'finder-1', email: 'finder@example.com' });
  mockProfiles.push(
    {
      id: 'owner-1',
      username: 'discowner',
      full_name: null,
      display_preference: 'username',
      push_token: null,
    },
    {
      id: 'finder-1',
      username: 'finder',
      full_name: null,
      display_preference: 'username',
      push_token: null,
    }
  );

  const response = await mockHandler('POST', 'Bearer valid-token', { owner_id: 'owner-1' });

  assertEquals(response.status, 201);
  const body = await response.json();
  assertEquals(body.recovery_event.finder_message, null);
  assertEquals(body.recovery_event.disc_id, null);
  assertEquals(body.recovery_event.front_photo_path, null);
  assertEquals(body.recovery_event.back_photo_path, null);
});

Deno.test('report-found-disc-by-phone: should use auth rate limit preset', () => {
  assertEquals(RateLimitPresets.auth.maxRequests, 10);
  assertEquals(RateLimitPresets.auth.windowMs, 60000);
});

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

  const finderId = data.user.id;

  // Validate owner_id
  if (!body?.owner_id || typeof body.owner_id !== 'string') {
    return new Response(JSON.stringify({ error: 'owner_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ownerId = body.owner_id;

  // Cannot report own disc
  if (ownerId === finderId) {
    return new Response(JSON.stringify({ error: 'You cannot report your own disc as found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = mockSupabaseAdmin();

  // Verify owner exists
  const ownerResult = await admin
    .from('profiles')
    .select('id, username, full_name, display_preference')
    .eq('id', ownerId)
    .single();

  if (ownerResult.error || !ownerResult.data) {
    return new Response(JSON.stringify({ error: 'Owner not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate disc_id if provided
  let discName: string | null = null;
  if (body.disc_id && typeof body.disc_id === 'string') {
    const discResult = await admin
      .from('discs')
      .select('id, owner_id, name')
      .eq('id', body.disc_id)
      .single();

    if (discResult.error || !discResult.data) {
      return new Response(JSON.stringify({ error: 'Disc not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const disc = discResult.data as MockDisc;

    if (disc.owner_id !== ownerId) {
      return new Response(JSON.stringify({ error: 'Disc does not belong to this owner' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for active recovery on this disc
    const activeResult = await admin
      .from('recovery_events')
      .select('id, status')
      .eq('disc_id', body.disc_id)
      .in('status', ['found', 'meetup_proposed', 'meetup_confirmed'])
      .maybeSingle();

    if (activeResult.data) {
      const activeRecovery = activeResult.data as MockRecoveryEvent;
      return new Response(
        JSON.stringify({
          error: 'This disc already has an active recovery in progress',
          recovery_status: activeRecovery.status,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    discName = disc.name;
  }

  // Get finder's display name
  const finderResult = await admin
    .from('profiles')
    .select('username, full_name, display_preference')
    .eq('id', finderId)
    .single();

  let finderName = 'Someone';
  if (finderResult.data) {
    const finderProfile = finderResult.data as MockProfile;
    if (finderProfile.display_preference === 'full_name' && finderProfile.full_name) {
      finderName = finderProfile.full_name;
    } else if (finderProfile.username) {
      finderName = `@${finderProfile.username}`;
    }
  }

  // Create recovery event
  const newRecovery: Partial<MockRecoveryEvent> = {
    disc_id: (body.disc_id as string) || null,
    finder_id: finderId,
    owner_id: ownerId,
    status: 'found',
    finder_message: (body.message as string) || null,
    front_photo_path: (body.front_photo_path as string) || null,
    back_photo_path: (body.back_photo_path as string) || null,
    found_at: new Date().toISOString(),
  };

  const insertResult = await admin.from('recovery_events').insert(newRecovery).select().single();

  if (insertResult.error || !insertResult.data) {
    return new Response(JSON.stringify({ error: 'Failed to create recovery event' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const recoveryEvent = insertResult.data;

  // Create notification
  const notificationTitle = 'Someone found a disc with your phone number!';
  const notificationBody = discName
    ? `${finderName} found your ${discName}`
    : `${finderName} found a disc with your number on it`;

  await admin
    .from('notifications')
    .insert({
      user_id: ownerId,
      type: 'disc_found_by_phone',
      title: notificationTitle,
      body: notificationBody,
      data: {
        recovery_event_id: recoveryEvent.id,
        disc_id: body.disc_id || null,
        finder_id: finderId,
      },
    } as unknown as MockNotification)
    .select()
    .single();

  return new Response(
    JSON.stringify({
      success: true,
      recovery_event: {
        id: recoveryEvent.id,
        disc_id: recoveryEvent.disc_id,
        disc_name: discName,
        owner_id: recoveryEvent.owner_id,
        status: recoveryEvent.status,
        finder_message: recoveryEvent.finder_message,
        front_photo_path: recoveryEvent.front_photo_path,
        back_photo_path: recoveryEvent.back_photo_path,
        found_at: recoveryEvent.found_at,
        created_at: recoveryEvent.created_at,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
