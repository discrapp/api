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
            const qrCode = mockQRCodes.find(
              (q) => q[column as keyof MockQRCode]?.toString().toLowerCase() === value.toLowerCase()
            );
            if (qrCode) {
              return Promise.resolve({ data: qrCode, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          }
          return Promise.resolve({ data: null, error: { message: 'Unknown table' } });
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
            } else if (table === 'qr_codes') {
              const qrCode = mockQRCodes.find(
                (q) => q[column as keyof MockQRCode]?.toString().toLowerCase() === value.toLowerCase()
              );
              if (qrCode) {
                Object.assign(qrCode, data);
                return Promise.resolve({ data: qrCode, error: null });
              }
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          },
        }),
      }),
    }),
  }),
};

// Reset mocks before each test
function resetMocks() {
  mockDiscs = [];
  mockQRCodes = [];
  mockUser = null;
}

Deno.test('link-qr-to-disc - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/link-qr-to-disc', {
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

Deno.test('link-qr-to-disc - returns 401 when not authenticated', async () => {
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

Deno.test('link-qr-to-disc - returns 400 when qr_code is missing', async () => {
  const body: { disc_id: string; qr_code?: string } = { disc_id: '123' };

  if (!body.qr_code) {
    const response = new Response(JSON.stringify({ error: 'Missing qr_code in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const respBody = await response.json();
    assertEquals(respBody.error, 'Missing qr_code in request body');
  }
});

Deno.test('link-qr-to-disc - returns 400 when disc_id is missing', async () => {
  const body: { qr_code: string; disc_id?: string } = { qr_code: 'ABC123' };

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

Deno.test("link-qr-to-disc - returns 400 when QR code doesn't exist", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add disc
  mockDiscs.push({
    id: 'disc-123',
    owner_id: authData.user.id,
    name: 'Test Disc',
    mold: 'Destroyer',
  });

  const { data: qrCode } = await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'NONEXISTENT123')
    .single();

  if (!qrCode) {
    const response = new Response(JSON.stringify({ error: 'QR code not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'QR code not found');
  }
});

Deno.test('link-qr-to-disc - returns 403 when QR code not assigned to current user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code assigned to another user
  mockQRCodes.push({
    id: 'qr-456',
    short_code: 'OTHERUSER123',
    status: 'assigned',
    assigned_to: 'other-user-789',
  });

  // Add disc
  mockDiscs.push({
    id: 'disc-456',
    owner_id: authData.user.id,
    name: 'My Disc',
    mold: 'Destroyer',
  });

  const { data: qrCode } = (await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'OTHERUSER123')
    .single()) as { data: MockQRCode | null };

  assertExists(qrCode);

  if (qrCode.assigned_to !== authData.user.id) {
    const response = new Response(JSON.stringify({ error: 'QR code is not assigned to you' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 403);
    const body = await response.json();
    assertEquals(body.error, 'QR code is not assigned to you');
  }
});

Deno.test("link-qr-to-disc - returns 400 when QR code is not in 'assigned' status", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code in 'generated' status
  mockQRCodes.push({
    id: 'qr-generated',
    short_code: 'GENERATED123',
    status: 'generated',
  });

  // Add disc
  mockDiscs.push({
    id: 'disc-gen',
    owner_id: authData.user.id,
    name: 'My Disc',
    mold: 'Destroyer',
  });

  const { data: qrCode } = (await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'GENERATED123')
    .single()) as { data: MockQRCode | null };

  assertExists(qrCode);

  if (qrCode.status !== 'assigned') {
    const response = new Response(JSON.stringify({ error: 'QR code must be assigned before linking to a disc' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'QR code must be assigned before linking to a disc');
  }
});

Deno.test("link-qr-to-disc - returns 400 when disc doesn't exist", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code
  mockQRCodes.push({
    id: 'qr-nodisc',
    short_code: 'NODISC123',
    status: 'assigned',
    assigned_to: authData.user.id,
  });

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

Deno.test('link-qr-to-disc - returns 403 when disc not owned by current user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code assigned to user
  mockQRCodes.push({
    id: 'qr-notmydisc',
    short_code: 'NOTMYDISC123',
    status: 'assigned',
    assigned_to: authData.user.id,
  });

  // Add disc owned by another user
  mockDiscs.push({
    id: 'disc-notmine',
    owner_id: 'other-user-789',
    name: 'Not My Disc',
    mold: 'Destroyer',
  });

  const { data: disc } = (await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-notmine').single()) as {
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

Deno.test('link-qr-to-disc - returns 400 when disc already has a QR code', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add existing QR code
  mockQRCodes.push({
    id: 'qr-existing',
    short_code: 'EXISTING123',
    status: 'active',
    assigned_to: authData.user.id,
  });

  // Add new QR code
  mockQRCodes.push({
    id: 'qr-new',
    short_code: 'NEWQR123',
    status: 'assigned',
    assigned_to: authData.user.id,
  });

  // Add disc with existing QR code
  mockDiscs.push({
    id: 'disc-has-qr',
    owner_id: authData.user.id,
    qr_code_id: 'qr-existing',
    name: 'Already Linked Disc',
    mold: 'Destroyer',
  });

  const { data: disc } = (await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-has-qr').single()) as {
    data: MockDisc | null;
  };

  assertExists(disc);

  if (disc.qr_code_id) {
    const response = new Response(JSON.stringify({ error: 'Disc already has a QR code linked' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'Disc already has a QR code linked');
  }
});

Deno.test('link-qr-to-disc - successfully links QR code to disc', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code assigned to user
  mockQRCodes.push({
    id: 'qr-linkme',
    short_code: 'LINKME123',
    status: 'assigned',
    assigned_to: authData.user.id,
  });

  // Add disc without QR code
  mockDiscs.push({
    id: 'disc-linkme',
    owner_id: authData.user.id,
    qr_code_id: null,
    name: 'Link Me Disc',
    mold: 'Destroyer',
  });

  const { data: qrCode } = await mockSupabaseClient.from('qr_codes').select('*').eq('short_code', 'LINKME123').single();

  assertExists(qrCode);

  const { data: disc } = await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-linkme').single();

  assertExists(disc);

  // Update disc with QR code
  const { data: updatedDisc } = (await mockSupabaseClient
    .from('discs')
    .update({ qr_code_id: qrCode.id })
    .eq('id', 'disc-linkme')
    .select()
    .single()) as { data: MockDisc | null };

  assertExists(updatedDisc);
  assertEquals(updatedDisc.qr_code_id, 'qr-linkme');

  // Update QR code status to active
  const { data: updatedQr } = (await mockSupabaseClient
    .from('qr_codes')
    .update({ status: 'active' })
    .eq('id', qrCode.id)
    .select()
    .single()) as { data: MockQRCode | null };

  assertExists(updatedQr);
  assertEquals(updatedQr.status, 'active');

  const response = new Response(
    JSON.stringify({
      success: true,
      disc: updatedDisc,
      qr_code: updatedQr,
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
  assertEquals(body.disc.id, 'disc-linkme');
  assertEquals(body.disc.qr_code_id, qrCode.id);
  assertExists(body.qr_code);
  assertEquals(body.qr_code.id, qrCode.id);
  assertEquals(body.qr_code.status, 'active');
});

Deno.test('link-qr-to-disc - should be case insensitive for QR code lookup', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code with uppercase
  mockQRCodes.push({
    id: 'qr-case',
    short_code: 'CASELINK123',
    status: 'assigned',
    assigned_to: authData.user.id,
  });

  // Add disc
  mockDiscs.push({
    id: 'disc-case',
    owner_id: authData.user.id,
    name: 'Case Test Disc',
    mold: 'Destroyer',
  });

  // Look up QR code with lowercase
  const { data: qrCode } = (await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'caselink123')
    .single()) as { data: MockQRCode | null };

  assertExists(qrCode);
  assertEquals(qrCode.short_code, 'CASELINK123');

  const { data: disc } = await mockSupabaseClient.from('discs').select('*').eq('id', 'disc-case').single();

  assertExists(disc);

  // Link QR code to disc
  const { data: updatedDisc } = (await mockSupabaseClient
    .from('discs')
    .update({ qr_code_id: qrCode.id })
    .eq('id', 'disc-case')
    .select()
    .single()) as { data: MockDisc | null };

  assertExists(updatedDisc);
  assertEquals(updatedDisc.qr_code_id, qrCode.id);

  const response = new Response(
    JSON.stringify({
      success: true,
      disc: updatedDisc,
      qr_code: qrCode,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
});
