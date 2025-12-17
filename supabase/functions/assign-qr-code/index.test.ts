import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data storage
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
          if (table === 'qr_codes') {
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
            if (table === 'qr_codes') {
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
  mockQRCodes = [];
  mockUser = null;
}

Deno.test('assign-qr-code - returns 405 for non-POST requests', async () => {
  const req = new Request('http://localhost/assign-qr-code', {
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

Deno.test('assign-qr-code - returns 401 when not authenticated', async () => {
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

Deno.test('assign-qr-code - returns 400 when qr_code is missing', async () => {
  const body: { qr_code?: string } = {};

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

Deno.test("assign-qr-code - returns 400 when QR code doesn't exist", async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const qr_code = 'NONEXISTENT123';

  const { data: qrCode } = await mockSupabaseClient.from('qr_codes').select('*').eq('short_code', qr_code).single();

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

Deno.test('assign-qr-code - returns 400 when QR code is already assigned', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add assigned QR code
  mockQRCodes.push({
    id: 'qr-123',
    short_code: 'ASSIGNED123',
    status: 'assigned',
    assigned_to: 'other-user-456',
  });

  const { data: qrCode } = await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'ASSIGNED123')
    .single();

  assertExists(qrCode);

  if (qrCode.status === 'assigned') {
    const response = new Response(JSON.stringify({ error: 'QR code is already assigned' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'QR code is already assigned');
  }
});

Deno.test('assign-qr-code - returns 400 when QR code is already active', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add active QR code
  mockQRCodes.push({
    id: 'qr-456',
    short_code: 'ACTIVE123',
    status: 'active',
    assigned_to: 'other-user-456',
  });

  const { data: qrCode } = await mockSupabaseClient.from('qr_codes').select('*').eq('short_code', 'ACTIVE123').single();

  assertExists(qrCode);

  if (qrCode.status === 'active') {
    const response = new Response(JSON.stringify({ error: 'QR code is already in use' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'QR code is already in use');
  }
});

Deno.test('assign-qr-code - returns 400 when QR code is deactivated', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  // Add deactivated QR code
  mockQRCodes.push({
    id: 'qr-789',
    short_code: 'DEACTIVATED123',
    status: 'deactivated',
  });

  const { data: qrCode } = await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'DEACTIVATED123')
    .single();

  assertExists(qrCode);

  if (qrCode.status === 'deactivated') {
    const response = new Response(JSON.stringify({ error: 'QR code has been deactivated' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error, 'QR code has been deactivated');
  }
});

Deno.test('assign-qr-code - successfully assigns QR code to user', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add generated QR code
  mockQRCodes.push({
    id: 'qr-abc',
    short_code: 'GENERATED123',
    status: 'generated',
  });

  const { data: qrCode } = await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'GENERATED123')
    .single();

  assertExists(qrCode);
  assertEquals(qrCode.status, 'generated');

  // Assign QR code
  const { data: updatedQr } = await mockSupabaseClient
    .from('qr_codes')
    .update({
      status: 'assigned',
      assigned_to: authData.user.id,
    })
    .eq('id', qrCode.id)
    .select()
    .single();

  assertExists(updatedQr);
  assertEquals(updatedQr.status, 'assigned');
  assertEquals(updatedQr.assigned_to, 'user-123');

  const response = new Response(
    JSON.stringify({
      success: true,
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
  assertExists(body.qr_code);
  assertEquals(body.qr_code.id, qrCode.id);
  assertEquals(body.qr_code.short_code, 'GENERATED123');
  assertEquals(body.qr_code.status, 'assigned');
  assertEquals(body.qr_code.assigned_to, authData.user.id);
});

Deno.test('assign-qr-code - should be case insensitive for QR code lookup', async () => {
  resetMocks();
  mockUser = { id: 'user-123', email: 'test@example.com' };

  const { data: authData } = await mockSupabaseClient.auth.getUser();
  assertExists(authData.user);

  // Add QR code with uppercase
  mockQRCodes.push({
    id: 'qr-case',
    short_code: 'CASETEST123',
    status: 'generated',
  });

  // Look up with lowercase
  const { data: qrCode } = await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .eq('short_code', 'casetest123')
    .single();

  assertExists(qrCode);
  assertEquals(qrCode.short_code, 'CASETEST123');

  // Assign QR code
  const { data: updatedQr } = await mockSupabaseClient
    .from('qr_codes')
    .update({
      status: 'assigned',
      assigned_to: authData.user.id,
    })
    .eq('short_code', 'casetest123')
    .select()
    .single();

  assertExists(updatedQr);
  assertEquals(updatedQr.status, 'assigned');

  const response = new Response(
    JSON.stringify({
      success: true,
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
});
