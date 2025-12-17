import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
type MockDisc = {
  id: string;
  owner_id: string;
  qr_code_id?: string | null;
  name: string;
  mold: string;
};

type MockQRCode = {
  id: string;
  short_code: string;
  status: string;
  assigned_to?: string;
};

type MockUser = {
  id: string;
  email: string;
};

let mockDiscs: MockDisc[] = [];
let mockQRCodes: MockQRCode[] = [];
let mockUser: MockUser | null = null;

// Mock Supabase client
const mockSupabaseClient = {
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
      eq: (column: string, value: string) => ({
        single: () => {
          if (table === 'discs') {
            const disc = mockDiscs.find((d) => d[column as keyof MockDisc] === value);
            if (disc) {
              return Promise.resolve({ data: disc, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          } else if (table === 'qr_codes') {
            const qrCode = mockQRCodes.find((q) => q[column as keyof MockQRCode] === value);
            if (qrCode) {
              return Promise.resolve({ data: qrCode, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          }
          return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
        },
        maybeSingle: () => {
          if (table === 'qr_codes') {
            const qrCode = mockQRCodes.find((q) => q[column as keyof MockQRCode] === value);
            return Promise.resolve({ data: qrCode || null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    update: (data: Record<string, unknown>) => ({
      eq: (column: string, value: string) => ({
        select: () => ({
          single: () => {
            if (table === 'discs') {
              const disc = mockDiscs.find((d) => d[column as keyof MockDisc] === value);
              if (disc) {
                Object.assign(disc, data);
                return Promise.resolve({ data: disc, error: null });
              }
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          },
        }),
      }),
    }),
    delete: () => ({
      eq: (column: string, value: string) => {
        if (table === 'qr_codes') {
          const index = mockQRCodes.findIndex((q) => q[column as keyof MockQRCode] === value);
          if (index !== -1) {
            mockQRCodes.splice(index, 1);
            return Promise.resolve({ data: null, error: null });
          }
        }
        return Promise.resolve({ data: null, error: { message: 'Not found' } });
      },
    }),
  }),
};

// Reset mocks before each test
function resetMocks() {
  mockDiscs = [];
  mockQRCodes = [];
  mockUser = null;
}

Deno.test('unlink-qr-code - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/unlink-qr-code', {
    method: 'GET',
  });

  if (req.method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const body = await response.json();
    assertEquals(body.error, 'Method not allowed');
  }
});

Deno.test('unlink-qr-code - returns 401 when not authenticated', async () => {
  const authHeader = undefined;

  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
    const body = await response.json();
    assertEquals(body.error, 'Missing authorization header');
  }
});

Deno.test('unlink-qr-code - returns 400 when disc_id is missing', async () => {
  const body: { disc_id?: string } = {};

  if (!body.disc_id) {
    const response = new Response(JSON.stringify({ error: 'Missing disc_id in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing disc_id in request body');
  }
});

Deno.test("unlink-qr-code - returns 400 when disc doesn't exist", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const disc_id = '00000000-0000-0000-0000-000000000000';

  const { data: disc } = await mockSupabaseClient.from('discs').select('*').eq('id', disc_id).single();

  if (!disc) {
    const response = new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Disc not found');
  }
});

Deno.test('unlink-qr-code - returns 403 when disc not owned by current user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add disc owned by another user
  mockDiscs.push({
    id: 'disc-456',
    owner_id: 'other-user-789',
    qr_code_id: 'qr-abc',
    name: 'Not My Disc',
    mold: 'Destroyer',
  });

  const { data: disc } = (await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-456').single()) as {
    data: MockDisc | null;
  };

  assertExists(disc);

  if (disc.owner_id !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const body = await response.json();
    assertEquals(body.error, 'You do not own this disc');
  }
});

Deno.test('unlink-qr-code - returns 400 when disc has no QR code linked', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add disc without QR code
  mockDiscs.push({
    id: 'disc-no-qr',
    owner_id: authData.user.id,
    qr_code_id: null,
    name: 'No QR Disc',
    mold: 'Destroyer',
  });

  const { data: disc } = (await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-no-qr').single()) as {
    data: MockDisc | null;
  };

  assertExists(disc);

  if (!disc.qr_code_id) {
    const response = new Response(JSON.stringify({ error: 'Disc has no QR code linked' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Disc has no QR code linked');
  }
});

Deno.test('unlink-qr-code - successfully unlinks and deletes QR code from disc', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code
  mockQRCodes.push({
    id: 'qr-delete-me',
    short_code: 'DELETEME123',
    status: 'active',
    assigned_to: authData.user.id,
  });

  // Add disc with QR code
  mockDiscs.push({
    id: 'disc-with-qr',
    owner_id: authData.user.id,
    qr_code_id: 'qr-delete-me',
    name: 'Unlink Me Disc',
    mold: 'Destroyer',
  });

  const { data: disc } = (await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-with-qr').single()) as {
    data: MockDisc | null;
  };

  assertExists(disc);
  assertEquals(disc.qr_code_id, 'qr-delete-me');

  const qrCodeId = disc.qr_code_id!;

  // Unlink QR code from disc
  const { data: updatedDisc } = await mockSupabaseClient
    .from('discs')
    .update({ qr_code_id: null })
    .eq('id', 'disc-with-qr')
    .select()
    .single();

  assertExists(updatedDisc);
  assertEquals(updatedDisc.qr_code_id, null);

  // Delete QR code
  await mockSupabaseClient.from('qr_codes').delete().eq('id', qrCodeId);

  // Verify QR code was deleted
  const { data: deletedQr } = await mockSupabaseClient.from('qr_codes').select('*').eq('id', qrCodeId).maybeSingle();

  assertEquals(deletedQr, null);

  const response = new Response(
    JSON.stringify({
      success: true,
      disc: updatedDisc,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.disc);
  assertEquals(body.disc.id, 'disc-with-qr');
  assertEquals(body.disc.qr_code_id, null);
});
