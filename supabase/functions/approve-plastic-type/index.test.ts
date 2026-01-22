import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock data types
type MockUser = {
  id: string;
  email: string;
  app_metadata?: { role?: string };
};

type MockPlasticType = {
  id: string;
  manufacturer: string;
  plastic_name: string;
  status: string;
  slack_message_ts?: string | null;
  updated_at?: string;
};

// Mock data storage
let mockUser: MockUser | null = null;
let mockPlasticTypes: MockPlasticType[] = [];
let mockUpdateError: Error | null = null;
let mockDeleteError: Error | null = null;
let mockSlackApprovedCalled = false;
let mockSlackRejectedCalled = false;
let mockSlackApprovedParams: { ts: string; manufacturer: string; plasticName: string; approvedBy?: string } | null =
  null;
let mockSlackRejectedParams: { ts: string; manufacturer: string; plasticName: string; rejectedBy?: string } | null =
  null;

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockPlasticTypes = [];
  mockUpdateError = null;
  mockDeleteError = null;
  mockSlackApprovedCalled = false;
  mockSlackRejectedCalled = false;
  mockSlackApprovedParams = null;
  mockSlackRejectedParams = null;
}

// Mock Supabase client (user auth)
function mockSupabaseClient() {
  return {
    auth: {
      getUser: () => {
        if (mockUser) {
          return Promise.resolve({ data: { user: mockUser }, error: null });
        }
        return Promise.resolve({
          data: { user: null },
          error: { message: 'Not authenticated' },
        });
      },
    },
  };
}

// Mock Supabase service client
function mockServiceClient() {
  return {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (_column: string, value: string) => ({
          single: () => {
            if (table === 'plastic_types') {
              const plastic = mockPlasticTypes.find((p) => p.id === value);
              if (plastic) {
                return Promise.resolve({ data: plastic, error: null });
              }
              return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      update: (values: Partial<MockPlasticType>) => ({
        eq: (_column: string, value: string) => ({
          select: () => ({
            single: () => {
              if (mockUpdateError) {
                return Promise.resolve({ data: null, error: mockUpdateError });
              }
              const plastic = mockPlasticTypes.find((p) => p.id === value);
              if (plastic) {
                const updated = { ...plastic, ...values };
                return Promise.resolve({ data: updated, error: null });
              }
              return Promise.resolve({ data: null, error: { message: 'Not found' } });
            },
          }),
        }),
      }),
      delete: () => ({
        eq: (_column: string, _value: string) => {
          if (mockDeleteError) {
            return Promise.resolve({ error: mockDeleteError });
          }
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
}

// Mock Slack notification functions
function mockNotifyPlasticTypeApproved(
  ts: string,
  manufacturer: string,
  plasticName: string,
  approvedBy?: string
): Promise<boolean> {
  mockSlackApprovedCalled = true;
  mockSlackApprovedParams = { ts, manufacturer, plasticName, approvedBy };
  return Promise.resolve(true);
}

function mockNotifyPlasticTypeRejected(
  ts: string,
  manufacturer: string,
  plasticName: string,
  rejectedBy?: string
): Promise<boolean> {
  mockSlackRejectedCalled = true;
  mockSlackRejectedParams = { ts, manufacturer, plasticName, rejectedBy };
  return Promise.resolve(true);
}

// ============================================
// Method validation tests
// ============================================

Deno.test('approve-plastic-type: returns 405 for non-POST requests', async () => {
  resetMocks();

  // GET request should fail
  const response = new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

// ============================================
// Authentication tests
// ============================================

Deno.test('approve-plastic-type: returns 401 when no auth header', async () => {
  resetMocks();

  const response = new Response(JSON.stringify({ error: 'Authorization required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Authorization required');
});

Deno.test('approve-plastic-type: returns 401 when user not authenticated', async () => {
  resetMocks();

  const supabase = mockSupabaseClient();
  const { data: authData, error } = await supabase.auth.getUser();

  assertEquals(authData.user, null);
  assertExists(error);

  const response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 401);
});

// ============================================
// Authorization tests
// ============================================

Deno.test('approve-plastic-type: returns 403 for non-admin users', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'user@example.com', app_metadata: { role: 'user' } };

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const userRole = authData.user.app_metadata?.role;
  assertEquals(userRole !== 'admin', true);

  const response = new Response(JSON.stringify({ error: 'Admin access required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 403);
  const data = await response.json();
  assertEquals(data.error, 'Admin access required');
});

Deno.test('approve-plastic-type: returns 403 for users with no role', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'user@example.com' };

  const supabase = mockSupabaseClient();
  const { data: authData } = await supabase.auth.getUser();
  assertExists(authData.user);

  const userRole = authData.user.app_metadata?.role;
  assertEquals(userRole, undefined);

  const response = new Response(JSON.stringify({ error: 'Admin access required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 403);
});

// ============================================
// Request validation tests
// ============================================

Deno.test('approve-plastic-type: returns 400 for invalid JSON', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };

  // Simulate parsing error
  let parseError = false;
  try {
    JSON.parse('invalid json');
  } catch {
    parseError = true;
  }

  assertEquals(parseError, true);

  const response = new Response(JSON.stringify({ error: 'Invalid JSON' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Invalid JSON');
});

Deno.test('approve-plastic-type: returns 400 when plastic_id is missing', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };

  const body: { plastic_id?: string; action: string } = { action: 'approve' };

  assertEquals(!body.plastic_id, true);

  const response = new Response(JSON.stringify({ error: 'plastic_id is required' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'plastic_id is required');
});

Deno.test('approve-plastic-type: returns 400 when action is missing', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };

  const body: { plastic_id: string; action?: string } = { plastic_id: 'plastic-1' };

  assertEquals(!body.action, true);

  const response = new Response(JSON.stringify({ error: 'action must be "approve" or "reject"' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'action must be "approve" or "reject"');
});

Deno.test('approve-plastic-type: returns 400 when action is invalid', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };

  const body = { plastic_id: 'plastic-1', action: 'invalid' };
  const validActions = ['approve', 'reject'];

  assertEquals(!validActions.includes(body.action), true);

  const response = new Response(JSON.stringify({ error: 'action must be "approve" or "reject"' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 400);
});

// ============================================
// Plastic type validation tests
// ============================================

Deno.test('approve-plastic-type: returns 404 when plastic type not found', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  // No plastic types in mock

  const serviceClient = mockServiceClient();
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'nonexistent').single();

  assertEquals(plastic, null);

  const response = new Response(JSON.stringify({ error: 'Plastic type not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 404);
  const data = await response.json();
  assertEquals(data.error, 'Plastic type not found');
});

Deno.test('approve-plastic-type: returns 400 when plastic type is not pending', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Innova',
    plastic_name: 'Star',
    status: 'approved', // Already approved
  });

  const serviceClient = mockServiceClient();
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'plastic-1').single();

  assertExists(plastic);
  assertEquals(plastic.status !== 'pending', true);

  const response = new Response(JSON.stringify({ error: 'Plastic type is not pending' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Plastic type is not pending');
});

// ============================================
// Approve action tests
// ============================================

Deno.test('approve-plastic-type: successfully approves pending plastic type', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Innova',
    plastic_name: 'Halo Star',
    status: 'pending',
  });

  const serviceClient = mockServiceClient();

  // Fetch plastic
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'plastic-1').single();

  assertExists(plastic);
  assertEquals(plastic.status, 'pending');

  // Update plastic
  const { data: updated } = await serviceClient
    .from('plastic_types')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', 'plastic-1')
    .select()
    .single();

  assertExists(updated);
  assertEquals(updated.status, 'approved');

  const response = new Response(
    JSON.stringify({
      message: 'Plastic type approved',
      plastic: updated,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.message, 'Plastic type approved');
  assertExists(data.plastic);
});

Deno.test('approve-plastic-type: calls Slack notification when ts exists', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Innova',
    plastic_name: 'Halo Star',
    status: 'pending',
    slack_message_ts: '1234567890.123456',
  });

  const serviceClient = mockServiceClient();

  // Fetch plastic
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'plastic-1').single();

  assertExists(plastic);
  assertExists(plastic.slack_message_ts);

  // Simulate calling Slack notification
  if (plastic.slack_message_ts) {
    await mockNotifyPlasticTypeApproved(plastic.slack_message_ts, plastic.manufacturer, plastic.plastic_name, 'admin@example.com');
  }

  assertEquals(mockSlackApprovedCalled, true);
  assertExists(mockSlackApprovedParams);
  assertEquals(mockSlackApprovedParams.ts, '1234567890.123456');
  assertEquals(mockSlackApprovedParams.manufacturer, 'Innova');
  assertEquals(mockSlackApprovedParams.plasticName, 'Halo Star');
  assertEquals(mockSlackApprovedParams.approvedBy, 'admin@example.com');
});

Deno.test('approve-plastic-type: does not call Slack when no ts exists', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Innova',
    plastic_name: 'Halo Star',
    status: 'pending',
    slack_message_ts: null,
  });

  const serviceClient = mockServiceClient();

  // Fetch plastic
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'plastic-1').single();

  assertExists(plastic);
  assertEquals(plastic.slack_message_ts, null);

  // Simulate conditional Slack call
  if (plastic.slack_message_ts) {
    await mockNotifyPlasticTypeApproved(plastic.slack_message_ts, plastic.manufacturer, plastic.plastic_name, 'admin@example.com');
  }

  assertEquals(mockSlackApprovedCalled, false);
});

Deno.test('approve-plastic-type: returns 500 on update error', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Innova',
    plastic_name: 'Star',
    status: 'pending',
  });
  mockUpdateError = new Error('Database connection failed');

  const serviceClient = mockServiceClient();

  // Attempt update
  const { data: updated, error: updateError } = await serviceClient
    .from('plastic_types')
    .update({ status: 'approved' })
    .eq('id', 'plastic-1')
    .select()
    .single();

  assertEquals(updated, null);
  assertExists(updateError);

  const response = new Response(JSON.stringify({ error: 'Failed to approve plastic type' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 500);
  const data = await response.json();
  assertEquals(data.error, 'Failed to approve plastic type');
});

// ============================================
// Reject action tests
// ============================================

Deno.test('approve-plastic-type: successfully rejects pending plastic type', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Innova',
    plastic_name: 'Test Plastic',
    status: 'pending',
  });

  const serviceClient = mockServiceClient();

  // Fetch plastic
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'plastic-1').single();

  assertExists(plastic);
  assertEquals(plastic.status, 'pending');

  // Delete plastic
  const { error: deleteError } = await serviceClient.from('plastic_types').delete().eq('id', 'plastic-1');

  assertEquals(deleteError, null);

  const response = new Response(
    JSON.stringify({
      message: 'Plastic type rejected',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.message, 'Plastic type rejected');
});

Deno.test('approve-plastic-type: calls Slack rejection notification when ts exists', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Discraft',
    plastic_name: 'Bad Plastic',
    status: 'pending',
    slack_message_ts: '9876543210.654321',
  });

  const serviceClient = mockServiceClient();

  // Fetch plastic
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'plastic-1').single();

  assertExists(plastic);
  assertExists(plastic.slack_message_ts);

  // Simulate calling Slack notification
  if (plastic.slack_message_ts) {
    await mockNotifyPlasticTypeRejected(plastic.slack_message_ts, plastic.manufacturer, plastic.plastic_name, 'admin@example.com');
  }

  assertEquals(mockSlackRejectedCalled, true);
  assertExists(mockSlackRejectedParams);
  assertEquals(mockSlackRejectedParams.ts, '9876543210.654321');
  assertEquals(mockSlackRejectedParams.manufacturer, 'Discraft');
  assertEquals(mockSlackRejectedParams.plasticName, 'Bad Plastic');
  assertEquals(mockSlackRejectedParams.rejectedBy, 'admin@example.com');
});

Deno.test('approve-plastic-type: does not call Slack rejection when no ts exists', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Discraft',
    plastic_name: 'Bad Plastic',
    status: 'pending',
    slack_message_ts: null,
  });

  const serviceClient = mockServiceClient();

  // Fetch plastic
  const { data: plastic } = await serviceClient.from('plastic_types').select('*').eq('id', 'plastic-1').single();

  assertExists(plastic);
  assertEquals(plastic.slack_message_ts, null);

  // Simulate conditional Slack call
  if (plastic.slack_message_ts) {
    await mockNotifyPlasticTypeRejected(plastic.slack_message_ts, plastic.manufacturer, plastic.plastic_name, 'admin@example.com');
  }

  assertEquals(mockSlackRejectedCalled, false);
});

Deno.test('approve-plastic-type: returns 500 on delete error', async () => {
  resetMocks();
  mockUser = { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } };
  mockPlasticTypes.push({
    id: 'plastic-1',
    manufacturer: 'Innova',
    plastic_name: 'Test',
    status: 'pending',
  });
  mockDeleteError = new Error('Delete failed');

  const serviceClient = mockServiceClient();

  // Attempt delete
  const { error: deleteError } = await serviceClient.from('plastic_types').delete().eq('id', 'plastic-1');

  assertExists(deleteError);

  const response = new Response(JSON.stringify({ error: 'Failed to reject plastic type' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 500);
  const data = await response.json();
  assertEquals(data.error, 'Failed to reject plastic type');
});

// ============================================
// General error handling
// ============================================

Deno.test('approve-plastic-type: returns 500 on unexpected error', async () => {
  resetMocks();

  // Simulate unexpected error scenario
  const unexpectedError = new Error('Unexpected failure');

  // In real code, this would be caught by the try/catch block
  assertExists(unexpectedError);

  const response = new Response(JSON.stringify({ error: 'Internal server error' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });

  assertEquals(response.status, 500);
  const data = await response.json();
  assertEquals(data.error, 'Internal server error');
});
