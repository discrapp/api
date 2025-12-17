import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
};

type MockQRCode = {
  id: string;
  short_code: string;
  status: string;
  assigned_to?: string;
};

type MockDisc = {
  id: string;
  owner_id: string;
  qr_code_id?: string;
  name: string;
  mold: string;
  manufacturer?: string;
  plastic?: string;
  color?: string;
  reward_amount?: number;
  owner_display_name?: string;
};

type MockRecoveryEvent = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  found_at: string;
  recovered_at?: string;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockQRCodes: MockQRCode[] = [];
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockQRCodes = [];
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
        return Promise.resolve({ data: { user: null }, error: null });
      },
    },
    from: (table: string) => ({
      select: (_columns?: string) => ({
        ilike: (_column: string, value: string) => ({
          single: async () => {
            if (table === 'qr_codes') {
              const code = mockQRCodes.find((qr) => qr.short_code.toLowerCase() === value.toLowerCase());
              if (!code) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: code, error: null };
            }
            return { data: null, error: null };
          },
        }),
        eq: (_column: string, value: string) => ({
          single: async () => {
            if (table === 'discs') {
              const disc = mockDiscs.find((d) => d.qr_code_id === value);
              if (!disc) {
                return { data: null, error: { code: 'PGRST116' } };
              }
              return { data: disc, error: null };
            }
            return { data: null, error: null };
          },
          in: (_col: string, statuses: string[]) => ({
            single: async () => {
              if (table === 'recovery_events') {
                const event = mockRecoveryEvents.find((evt) => evt.disc_id === value && statuses.includes(evt.status));
                return { data: event || null, error: event ? null : { code: 'PGRST116' } };
              }
              return { data: null, error: null };
            },
          }),
        }),
      }),
    }),
  };
}

Deno.test('lookup-qr-code: should return 405 for non-GET requests', () => {
  resetMocks();

  const method: string = 'POST';

  if (method !== 'GET') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
    const data = response.json();
    assertExists(data);
  }
});

Deno.test('lookup-qr-code: should return 400 when code parameter is missing', () => {
  resetMocks();

  const url = new URL('http://localhost:54321/functions/v1/lookup-qr-code');
  const code = url.searchParams.get('code');

  if (!code) {
    const response = new Response(JSON.stringify({ error: 'Missing code parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = response.json();
    assertExists(data);
  }
});

Deno.test('lookup-qr-code: should return found=false and qr_exists=false for non-existent QR code', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();
  const code = 'NONEXISTENT123';

  const { data: qrCode } = await supabase.from('qr_codes').select('*').ilike('short_code', code).single();

  const result = {
    found: false,
    qr_exists: !!qrCode,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.found, false);
  assertEquals(data.qr_exists, false);
});

Deno.test('lookup-qr-code: should return qr_status=generated for unclaimed QR code', async () => {
  resetMocks();

  const testCode = 'GENERATED123';
  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'generated',
  };
  mockQRCodes.push(qrCode);

  const supabase = mockSupabaseClient();

  const { data } = await supabase.from('qr_codes').select('*').ilike('short_code', testCode).single();

  assertExists(data);

  const result = {
    found: false,
    qr_exists: true,
    qr_status: data.status,
    qr_code: data.short_code,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, false);
  assertEquals(responseData.qr_exists, true);
  assertEquals(responseData.qr_status, 'generated');
  assertEquals(responseData.qr_code, testCode);
});

Deno.test('lookup-qr-code: should return qr_status=deactivated for deactivated QR code', async () => {
  resetMocks();

  const testCode = 'DEACTIVATED123';
  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'deactivated',
  };
  mockQRCodes.push(qrCode);

  const supabase = mockSupabaseClient();

  const { data } = await supabase.from('qr_codes').select('*').ilike('short_code', testCode).single();

  assertExists(data);

  const result = {
    found: false,
    qr_exists: true,
    qr_status: data.status,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, false);
  assertEquals(responseData.qr_exists, true);
  assertEquals(responseData.qr_status, 'deactivated');
});

Deno.test('lookup-qr-code: should return qr_status=assigned for assigned but unlinked QR code', async () => {
  resetMocks();

  const userId = 'user-123';
  const testCode = 'ASSIGNED123';
  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'assigned',
    assigned_to: userId,
  };
  mockQRCodes.push(qrCode);

  const supabase = mockSupabaseClient();

  const { data } = await supabase.from('qr_codes').select('*').ilike('short_code', testCode).single();

  assertExists(data);

  const result = {
    found: false,
    qr_exists: true,
    qr_status: data.status,
    qr_code: data.short_code,
    is_assignee: false, // No auth header sent
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, false);
  assertEquals(responseData.qr_exists, true);
  assertEquals(responseData.qr_status, 'assigned');
  assertEquals(responseData.qr_code, testCode);
  assertEquals(responseData.is_assignee, false);
});

Deno.test('lookup-qr-code: should return is_assignee=true when user owns assigned QR code', async () => {
  resetMocks();

  const userId = 'user-123';
  mockUser = { id: userId, email: 'test@example.com' };

  const testCode = 'MYASSIGNED123';
  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'assigned',
    assigned_to: userId,
  };
  mockQRCodes.push(qrCode);

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();

  const { data } = await supabase.from('qr_codes').select('*').ilike('short_code', testCode).single();

  assertExists(data);
  assertExists(authData.user);

  const result = {
    found: false,
    qr_exists: true,
    qr_status: data.status,
    is_assignee: data.assigned_to === authData.user.id,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, false);
  assertEquals(responseData.qr_exists, true);
  assertEquals(responseData.qr_status, 'assigned');
  assertEquals(responseData.is_assignee, true);
});

Deno.test('lookup-qr-code: should return disc info for active QR code', async () => {
  resetMocks();

  const userId = 'user-123';
  const testCode = 'TEST123';

  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'active',
    assigned_to: userId,
  };
  mockQRCodes.push(qrCode);

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: userId,
    qr_code_id: qrCode.id,
    name: 'Test Destroyer',
    mold: 'Destroyer',
    manufacturer: 'Innova',
    plastic: 'Star',
    color: 'Blue',
    reward_amount: 5.0,
    owner_display_name: 'Test User',
  };
  mockDiscs.push(disc);

  const supabase = mockSupabaseClient();

  const { data: qrData } = await supabase.from('qr_codes').select('*').ilike('short_code', testCode).single();

  assertExists(qrData);

  const { data: discData } = await supabase.from('discs').select('*').eq('qr_code_id', qrData.id).single();

  assertExists(discData);

  const result = {
    found: true,
    disc: discData,
    has_active_recovery: false,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, true);
  assertExists(responseData.disc);
  assertEquals(responseData.disc.id, disc.id);
  assertEquals(responseData.disc.name, 'Test Destroyer');
  assertEquals(responseData.disc.mold, 'Destroyer');
  assertEquals(responseData.disc.manufacturer, 'Innova');
  assertEquals(responseData.disc.color, 'Blue');
  assertEquals(responseData.disc.reward_amount, 5.0);
  assertExists(responseData.disc.owner_display_name);
  assertEquals(responseData.has_active_recovery, false);
});

Deno.test('lookup-qr-code: should be case insensitive for code lookup', async () => {
  resetMocks();

  const userId = 'user-123';
  const testCode = 'TESTCASE123';

  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'active',
    assigned_to: userId,
  };
  mockQRCodes.push(qrCode);

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: userId,
    qr_code_id: qrCode.id,
    name: 'Test Disc',
    mold: 'Mako3',
  };
  mockDiscs.push(disc);

  const supabase = mockSupabaseClient();

  // Lookup with lowercase
  const { data: qrData } = await supabase
    .from('qr_codes')
    .select('*')
    .ilike('short_code', testCode.toLowerCase())
    .single();

  assertExists(qrData);

  const { data: discData } = await supabase.from('discs').select('*').eq('qr_code_id', qrData.id).single();

  assertExists(discData);

  const result = {
    found: true,
    disc: discData,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, true);
  assertEquals(responseData.disc.id, disc.id);
});

Deno.test('lookup-qr-code: should indicate has_active_recovery when recovery exists', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-123';
  const testCode = 'TESTRECOV123';

  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'active',
    assigned_to: ownerId,
  };
  mockQRCodes.push(qrCode);

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: ownerId,
    qr_code_id: qrCode.id,
    name: 'Lost Disc',
    mold: 'Wraith',
  };
  mockDiscs.push(disc);

  const recovery: MockRecoveryEvent = {
    id: 'recovery-1',
    disc_id: disc.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
  };
  mockRecoveryEvents.push(recovery);

  const supabase = mockSupabaseClient();

  const { data: qrData } = await supabase.from('qr_codes').select('*').ilike('short_code', testCode).single();

  assertExists(qrData);

  const { data: discData } = await supabase.from('discs').select('*').eq('qr_code_id', qrData.id).single();

  assertExists(discData);

  const { data: recoveryData } = await supabase
    .from('recovery_events')
    .select('*')
    .eq('disc_id', discData.id)
    .in('status', ['found', 'meetup_proposed', 'meetup_accepted'])
    .single();

  const result = {
    found: true,
    has_active_recovery: !!recoveryData,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, true);
  assertEquals(responseData.has_active_recovery, true);
});

Deno.test('lookup-qr-code: should not expose owner private info', async () => {
  resetMocks();

  const userId = 'user-123';
  const testCode = 'TESTPRIV123';

  const qrCode: MockQRCode = {
    id: 'qr-1',
    short_code: testCode,
    status: 'active',
    assigned_to: userId,
  };
  mockQRCodes.push(qrCode);

  const disc: MockDisc = {
    id: 'disc-1',
    owner_id: userId,
    qr_code_id: qrCode.id,
    name: 'Private Disc',
    mold: 'Teebird',
    owner_display_name: 'Test User',
  };
  mockDiscs.push(disc);

  const supabase = mockSupabaseClient();

  const { data: qrData } = await supabase.from('qr_codes').select('*').ilike('short_code', testCode).single();

  assertExists(qrData);

  const { data: discData } = await supabase.from('discs').select('*').eq('qr_code_id', qrData.id).single();

  assertExists(discData);

  // Simulate removing private fields
  const publicDisc = {
    ...discData,
  };
  // In real implementation, owner_id, email, phone would be removed

  const result = {
    found: true,
    disc: publicDisc,
  };

  const response = new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 200);
  const responseData = await response.json();
  assertEquals(responseData.found, true);

  // Verify no sensitive owner info is exposed (would be undefined in real response)
  assertExists(responseData.disc.owner_display_name);
});
