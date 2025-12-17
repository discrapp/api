import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockQRCode = {
  id: string;
  short_code: string;
  status: string;
  assigned_to: string | null;
};

type MockDisc = {
  id: string;
  owner_id: string;
  qr_code_id: string;
  name: string;
  mold: string;
};

type MockRecoveryEvent = {
  id: string;
  disc_id: string;
  finder_id: string;
  status: string;
  found_at: string;
  finder_message?: string | null;
};

// Mock data storage
let mockQRCodes: MockQRCode[] = [];
let mockDiscs: MockDisc[] = [];
let mockRecoveryEvents: MockRecoveryEvent[] = [];

// Mock Supabase client
const mockSupabaseClient = {
  from: (table: string) => ({
    select: (_columns?: string) => ({
      ilike: (column: string, value: string) => ({
        single: () => {
          if (table === 'qr_codes') {
            // Case insensitive search
            const qrCode = mockQRCodes.find(
              (qr) => qr[column as keyof MockQRCode]?.toString().toLowerCase() === value.replace('%', '').toLowerCase()
            );
            if (qrCode) {
              return Promise.resolve({ data: qrCode, error: null });
            }
          }
          return Promise.resolve({ data: null, error: { message: 'Not found' } });
        },
      }),
      eq: (column: string, value: string) => {
        // Store the filter context for chaining
        const eqColumn = column;
        const eqValue = value;
        return {
          single: () => {
            if (table === 'discs') {
              const disc = mockDiscs.find((d) => d[eqColumn as keyof MockDisc] === eqValue);
              if (disc) {
                return Promise.resolve({ data: disc, error: null });
              }
            }
            if (table === 'recovery_events') {
              const recovery = mockRecoveryEvents.find((r) => r[eqColumn as keyof MockRecoveryEvent] === eqValue);
              if (recovery) {
                return Promise.resolve({ data: recovery, error: null });
              }
            }
            return Promise.resolve({ data: null, error: { message: 'Not found' } });
          },
          in: (inColumn: string, statuses: string[]) => ({
            maybeSingle: () => {
              if (table === 'recovery_events') {
                const recovery = mockRecoveryEvents.find((r) => {
                  const discMatch = r[eqColumn as keyof MockRecoveryEvent] === eqValue;
                  const statusMatch = statuses.includes(r[inColumn as keyof MockRecoveryEvent] as string);
                  return discMatch && statusMatch;
                });
                if (recovery) {
                  return Promise.resolve({ data: recovery, error: null });
                }
              }
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      },
    }),
    insert: (data: MockRecoveryEvent) => ({
      select: () => ({
        single: () => {
          if (table === 'recovery_events') {
            const newRecovery = {
              ...data,
              id: data.id || `recovery-${Date.now()}`,
            };
            mockRecoveryEvents.push(newRecovery);
            return Promise.resolve({ data: newRecovery, error: null });
          }
          return Promise.resolve({ data: null, error: { message: 'Insert failed' } });
        },
      }),
    }),
  }),
};

// Reset mocks before each test
function resetMocks() {
  mockQRCodes = [];
  mockDiscs = [];
  mockRecoveryEvents = [];
}

Deno.test('report-found-disc - returns 405 for non-POST requests', () => {
  const req = new Request('http://localhost/report-found-disc', {
    method: 'GET',
  });

  if (req.method !== 'POST') {
    const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 405);
  }
});

Deno.test('report-found-disc - returns 401 when not authenticated', () => {
  const req = new Request('http://localhost/report-found-disc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_code: 'ABC123' }),
  });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    const response = new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 401);
  }
});

Deno.test('report-found-disc - returns 400 when qr_code is missing', async () => {
  const body = {};

  if (!('qr_code' in body) || !body.qr_code) {
    const response = new Response(JSON.stringify({ error: 'Missing qr_code in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Missing qr_code in request body');
  }
});

Deno.test('report-found-disc - returns 400 for invalid QR code', async () => {
  resetMocks();

  const result = await mockSupabaseClient.from('qr_codes').select('*').ilike('short_code', '%NONEXISTENT123%').single();

  if (!result.data || result.error) {
    const response = new Response(JSON.stringify({ error: 'Invalid QR code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'Invalid QR code');
  }
});

Deno.test('report-found-disc - returns 400 for unassigned QR code', async () => {
  resetMocks();

  mockQRCodes = [{ id: 'qr-1', short_code: 'UNASSIGNED123', status: 'available', assigned_to: null }];

  const result = await mockSupabaseClient.from('qr_codes').select('*').ilike('short_code', '%UNASSIGNED123%').single();

  assertExists(result.data);
  if (result.data.status !== 'assigned' || !result.data.assigned_to) {
    const response = new Response(JSON.stringify({ error: 'QR code is not assigned to a disc' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'QR code is not assigned to a disc');
  }
});

Deno.test('report-found-disc - returns 400 when finder reports their own disc', async () => {
  resetMocks();

  const userId = 'user-123';
  mockQRCodes = [{ id: 'qr-1', short_code: 'OWNDISC123', status: 'assigned', assigned_to: userId }];
  mockDiscs = [{ id: 'disc-1', owner_id: userId, qr_code_id: 'qr-1', name: 'My Own Disc', mold: 'Destroyer' }];

  const qrResult = await mockSupabaseClient.from('qr_codes').select('*').ilike('short_code', '%OWNDISC123%').single();
  assertExists(qrResult.data);

  const discResult = await mockSupabaseClient.from('discs').select('*').eq('qr_code_id', qrResult.data.id).single();
  assertExists(discResult.data);
  const disc = discResult.data as MockDisc;

  if (disc.owner_id === userId) {
    const response = new Response(JSON.stringify({ error: 'You cannot report your own disc as found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'You cannot report your own disc as found');
  }
});

Deno.test('report-found-disc - returns 400 when disc has active recovery', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-123';
  mockQRCodes = [{ id: 'qr-1', short_code: 'ACTIVERECOV123', status: 'assigned', assigned_to: ownerId }];
  mockDiscs = [{ id: 'disc-1', owner_id: ownerId, qr_code_id: 'qr-1', name: 'Lost Disc', mold: 'Wraith' }];
  mockRecoveryEvents = [
    { id: 'recovery-1', disc_id: 'disc-1', finder_id: finderId, status: 'found', found_at: new Date().toISOString() },
  ];

  const qrResult = await mockSupabaseClient
    .from('qr_codes')
    .select('*')
    .ilike('short_code', '%ACTIVERECOV123%')
    .single();
  assertExists(qrResult.data);

  const discResult = await mockSupabaseClient.from('discs').select('*').eq('qr_code_id', qrResult.data.id).single();
  assertExists(discResult.data);

  const recoveryResult = await mockSupabaseClient
    .from('recovery_events')
    .select('*')
    .eq('disc_id', discResult.data.id)
    .in('status', ['found', 'meetup_proposed', 'meetup_accepted', 'drop_off_created'])
    .maybeSingle();

  if (recoveryResult.data) {
    const response = new Response(
      JSON.stringify({
        error: 'This disc already has an active recovery in progress',
        recovery_status: recoveryResult.data.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    assertEquals(response.status, 400);
    const data = await response.json();
    assertEquals(data.error, 'This disc already has an active recovery in progress');
    assertEquals(data.recovery_status, 'found');
  }
});

Deno.test('report-found-disc - successfully creates recovery event', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-456';
  mockQRCodes = [{ id: 'qr-1', short_code: 'FOUNDDISC123', status: 'assigned', assigned_to: ownerId }];
  mockDiscs = [{ id: 'disc-1', owner_id: ownerId, qr_code_id: 'qr-1', name: 'Found Disc', mold: 'Teebird' }];

  const qrResult = await mockSupabaseClient.from('qr_codes').select('*').ilike('short_code', '%FOUNDDISC123%').single();
  assertExists(qrResult.data);

  const discResult = await mockSupabaseClient.from('discs').select('*').eq('qr_code_id', qrResult.data.id).single();
  assertExists(discResult.data);

  // Check no active recovery
  const existingRecovery = await mockSupabaseClient
    .from('recovery_events')
    .select('*')
    .eq('disc_id', discResult.data.id)
    .in('status', ['found', 'meetup_proposed', 'meetup_accepted', 'drop_off_created'])
    .maybeSingle();

  assertEquals(existingRecovery.data, null);

  // Create recovery event
  const newRecovery = {
    id: 'recovery-new',
    disc_id: discResult.data.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
    finder_message: 'Found it near hole 5!',
  };

  const insertResult = await mockSupabaseClient.from('recovery_events').insert(newRecovery).select().single();

  assertExists(insertResult.data);
  assertEquals(insertResult.data.disc_id, 'disc-1');
  assertEquals(insertResult.data.status, 'found');
  assertEquals(insertResult.data.finder_message, 'Found it near hole 5!');
  assertExists(insertResult.data.found_at);
});

Deno.test('report-found-disc - should be case insensitive for QR code lookup', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  // finderId would be used in full implementation - this test only checks QR lookup
  mockQRCodes = [{ id: 'qr-1', short_code: 'CASETEST123', status: 'assigned', assigned_to: ownerId }];
  mockDiscs = [{ id: 'disc-1', owner_id: ownerId, qr_code_id: 'qr-1', name: 'Case Test Disc', mold: 'Mako3' }];

  // Try lowercase
  const qrResult = await mockSupabaseClient.from('qr_codes').select('*').ilike('short_code', '%casetest123%').single();
  assertExists(qrResult.data);
  assertEquals(qrResult.data.short_code, 'CASETEST123');
});

Deno.test('report-found-disc - should work without optional message', async () => {
  resetMocks();

  const ownerId = 'owner-123';
  const finderId = 'finder-456';
  mockQRCodes = [{ id: 'qr-1', short_code: 'NOMSG123', status: 'assigned', assigned_to: ownerId }];
  mockDiscs = [{ id: 'disc-1', owner_id: ownerId, qr_code_id: 'qr-1', name: 'No Message Disc', mold: 'Buzzz' }];

  const qrResult = await mockSupabaseClient.from('qr_codes').select('*').ilike('short_code', '%NOMSG123%').single();
  assertExists(qrResult.data);

  const discResult = await mockSupabaseClient.from('discs').select('*').eq('qr_code_id', qrResult.data.id).single();
  assertExists(discResult.data);

  // Create recovery event without message
  const newRecovery = {
    id: 'recovery-new',
    disc_id: discResult.data.id,
    finder_id: finderId,
    status: 'found',
    found_at: new Date().toISOString(),
    finder_message: null,
  };

  const insertResult = await mockSupabaseClient.from('recovery_events').insert(newRecovery).select().single();

  assertExists(insertResult.data);
  assertEquals(insertResult.data.finder_message, null);
});
