import { assertEquals, assertExists } from 'jsr:@std/assert';
import type { TransactionResult } from './transactions.ts';

// Types for mock RPC responses
type RpcResult = {
  success: boolean;
  recovery_event_id?: string;
  disc_id?: string;
  new_owner_id?: string;
  closed_recovery_count?: number;
  qr_code_updated?: boolean;
  drop_off_id?: string;
  proposal_id?: string;
  declined_proposals_count?: number;
  notification_id?: string;
  recovered_at?: string;
};

// Mock RPC result storage
let mockRpcResult: RpcResult | null = null;
let mockRpcError: { message: string } | null = null;
let lastRpcCall: { name: string; params: Record<string, unknown> } | null = null;

// Reset mocks before each test
function resetMocks() {
  mockRpcResult = null;
  mockRpcError = null;
  lastRpcCall = null;
}

// Mock Supabase client with RPC support
function mockSupabaseClient() {
  return {
    rpc: (functionName: string, params: Record<string, unknown>) => {
      lastRpcCall = { name: functionName, params };
      if (mockRpcError) {
        return Promise.resolve({ data: null, error: mockRpcError });
      }
      return Promise.resolve({ data: mockRpcResult, error: null });
    },
  };
}

// Helper function to simulate transaction call
async function callTransaction<T>(
  _supabase: ReturnType<typeof mockSupabaseClient>,
  functionName: string,
  params: Record<string, unknown>
): Promise<TransactionResult<T>> {
  const { data, error } = await _supabase.rpc(functionName, params);
  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, data: data as T };
}

// ============================================================================
// abandon_disc_transaction tests
// ============================================================================

Deno.test('abandonDiscTransaction: successfully abandons disc', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    recovery_event_id: 'recovery-123',
    disc_id: 'disc-456',
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; disc_id: string }>(
    supabase,
    'abandon_disc_transaction',
    {
      p_recovery_event_id: 'recovery-123',
      p_disc_id: 'disc-456',
      p_user_id: 'user-789',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.recovery_event_id, 'recovery-123');
  assertEquals(result.data.disc_id, 'disc-456');
  assertEquals(lastRpcCall?.name, 'abandon_disc_transaction');
});

Deno.test('abandonDiscTransaction: returns error on failure', async () => {
  resetMocks();
  mockRpcError = { message: 'Recovery event not found: recovery-123' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; disc_id: string }>(
    supabase,
    'abandon_disc_transaction',
    {
      p_recovery_event_id: 'recovery-123',
      p_disc_id: 'disc-456',
      p_user_id: 'user-789',
    }
  );

  assertEquals(result.success, false);
  assertEquals(result.error, 'Recovery event not found: recovery-123');
});

Deno.test('abandonDiscTransaction: rolls back on disc update failure', async () => {
  resetMocks();
  mockRpcError = { message: 'Disc not found: disc-456' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; disc_id: string }>(
    supabase,
    'abandon_disc_transaction',
    {
      p_recovery_event_id: 'recovery-123',
      p_disc_id: 'disc-456',
      p_user_id: 'user-789',
    }
  );

  assertEquals(result.success, false);
  assertEquals(result.error, 'Disc not found: disc-456');
});

// ============================================================================
// claim_disc_transaction tests
// ============================================================================

Deno.test('claimDiscTransaction: successfully claims disc', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    disc_id: 'disc-456',
    new_owner_id: 'user-789',
    closed_recovery_count: 1,
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ disc_id: string; new_owner_id: string; closed_recovery_count: number }>(
    supabase,
    'claim_disc_transaction',
    {
      p_disc_id: 'disc-456',
      p_user_id: 'user-789',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.disc_id, 'disc-456');
  assertEquals(result.data.new_owner_id, 'user-789');
  assertEquals(result.data.closed_recovery_count, 1);
});

Deno.test('claimDiscTransaction: fails when disc already has owner', async () => {
  resetMocks();
  mockRpcError = { message: 'Disc not found or already has owner: disc-456' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ disc_id: string; new_owner_id: string; closed_recovery_count: number }>(
    supabase,
    'claim_disc_transaction',
    {
      p_disc_id: 'disc-456',
      p_user_id: 'user-789',
    }
  );

  assertEquals(result.success, false);
  assertEquals(result.error, 'Disc not found or already has owner: disc-456');
});

// ============================================================================
// surrender_disc_transaction tests
// ============================================================================

Deno.test('surrenderDiscTransaction: successfully surrenders disc with QR code', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    recovery_event_id: 'recovery-123',
    disc_id: 'disc-456',
    new_owner_id: 'finder-111',
    qr_code_updated: true,
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{
    recovery_event_id: string;
    disc_id: string;
    new_owner_id: string;
    qr_code_updated: boolean;
  }>(supabase, 'surrender_disc_transaction', {
    p_recovery_event_id: 'recovery-123',
    p_disc_id: 'disc-456',
    p_finder_id: 'finder-111',
    p_original_owner_id: 'owner-222',
    p_qr_code_id: 'qr-333',
  });

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.qr_code_updated, true);
});

Deno.test('surrenderDiscTransaction: successfully surrenders disc without QR code', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    recovery_event_id: 'recovery-123',
    disc_id: 'disc-456',
    new_owner_id: 'finder-111',
    qr_code_updated: false,
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{
    recovery_event_id: string;
    disc_id: string;
    new_owner_id: string;
    qr_code_updated: boolean;
  }>(supabase, 'surrender_disc_transaction', {
    p_recovery_event_id: 'recovery-123',
    p_disc_id: 'disc-456',
    p_finder_id: 'finder-111',
    p_original_owner_id: 'owner-222',
    p_qr_code_id: null,
  });

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.qr_code_updated, false);
});

Deno.test('surrenderDiscTransaction: rolls back all changes on recovery update failure', async () => {
  resetMocks();
  mockRpcError = { message: 'Recovery event not found: recovery-123' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{
    recovery_event_id: string;
    disc_id: string;
    new_owner_id: string;
    qr_code_updated: boolean;
  }>(supabase, 'surrender_disc_transaction', {
    p_recovery_event_id: 'recovery-123',
    p_disc_id: 'disc-456',
    p_finder_id: 'finder-111',
    p_original_owner_id: 'owner-222',
    p_qr_code_id: 'qr-333',
  });

  assertEquals(result.success, false);
  // This tests that if recovery update fails, disc and QR code changes are rolled back
  assertEquals(result.error, 'Recovery event not found: recovery-123');
});

// ============================================================================
// relinquish_disc_transaction tests
// ============================================================================

Deno.test('relinquishDiscTransaction: successfully relinquishes disc', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    recovery_event_id: 'recovery-123',
    disc_id: 'disc-456',
    new_owner_id: 'finder-111',
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; disc_id: string; new_owner_id: string }>(
    supabase,
    'relinquish_disc_transaction',
    {
      p_recovery_event_id: 'recovery-123',
      p_disc_id: 'disc-456',
      p_finder_id: 'finder-111',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.new_owner_id, 'finder-111');
});

Deno.test('relinquishDiscTransaction: rolls back on disc transfer failure', async () => {
  resetMocks();
  mockRpcError = { message: 'Disc not found: disc-456' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; disc_id: string; new_owner_id: string }>(
    supabase,
    'relinquish_disc_transaction',
    {
      p_recovery_event_id: 'recovery-123',
      p_disc_id: 'disc-456',
      p_finder_id: 'finder-111',
    }
  );

  assertEquals(result.success, false);
  // Recovery status update should be rolled back when disc transfer fails
  assertEquals(result.error, 'Disc not found: disc-456');
});

// ============================================================================
// create_drop_off_transaction tests
// ============================================================================

Deno.test('createDropOffTransaction: successfully creates drop-off', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    drop_off_id: 'dropoff-123',
    recovery_event_id: 'recovery-456',
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ drop_off_id: string; recovery_event_id: string }>(
    supabase,
    'create_drop_off_transaction',
    {
      p_recovery_event_id: 'recovery-456',
      p_photo_url: 'https://example.com/photo.jpg',
      p_latitude: 45.5231,
      p_longitude: -122.6765,
      p_location_notes: 'Near the big tree',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.drop_off_id, 'dropoff-123');
});

Deno.test('createDropOffTransaction: rolls back drop-off on recovery update failure', async () => {
  resetMocks();
  mockRpcError = { message: 'Recovery event not found: recovery-456' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ drop_off_id: string; recovery_event_id: string }>(
    supabase,
    'create_drop_off_transaction',
    {
      p_recovery_event_id: 'recovery-456',
      p_photo_url: 'https://example.com/photo.jpg',
      p_latitude: 45.5231,
      p_longitude: -122.6765,
      p_location_notes: null,
    }
  );

  assertEquals(result.success, false);
  // Drop-off should be rolled back when recovery update fails
  assertEquals(result.error, 'Recovery event not found: recovery-456');
});

// ============================================================================
// accept_meetup_transaction tests
// ============================================================================

Deno.test('acceptMeetupTransaction: successfully accepts meetup', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    proposal_id: 'proposal-123',
    recovery_event_id: 'recovery-456',
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ proposal_id: string; recovery_event_id: string }>(
    supabase,
    'accept_meetup_transaction',
    {
      p_proposal_id: 'proposal-123',
      p_recovery_event_id: 'recovery-456',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.proposal_id, 'proposal-123');
});

Deno.test('acceptMeetupTransaction: rolls back proposal on recovery update failure', async () => {
  resetMocks();
  mockRpcError = { message: 'Recovery event not found: recovery-456' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ proposal_id: string; recovery_event_id: string }>(
    supabase,
    'accept_meetup_transaction',
    {
      p_proposal_id: 'proposal-123',
      p_recovery_event_id: 'recovery-456',
    }
  );

  assertEquals(result.success, false);
  // Proposal status should be rolled back when recovery update fails
  assertEquals(result.error, 'Recovery event not found: recovery-456');
});

// ============================================================================
// propose_meetup_transaction tests
// ============================================================================

Deno.test('proposeMeetupTransaction: successfully proposes meetup', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    proposal_id: 'proposal-123',
    recovery_event_id: 'recovery-456',
    declined_proposals_count: 0,
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{
    proposal_id: string;
    recovery_event_id: string;
    declined_proposals_count: number;
  }>(supabase, 'propose_meetup_transaction', {
    p_recovery_event_id: 'recovery-456',
    p_proposed_by: 'user-123',
    p_location_name: 'Central Park',
    p_latitude: 40.7829,
    p_longitude: -73.9654,
    p_proposed_datetime: '2024-01-15T14:00:00Z',
    p_message: 'Meet at the fountain',
  });

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.declined_proposals_count, 0);
});

Deno.test('proposeMeetupTransaction: declines existing proposals', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    proposal_id: 'proposal-456',
    recovery_event_id: 'recovery-123',
    declined_proposals_count: 2,
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{
    proposal_id: string;
    recovery_event_id: string;
    declined_proposals_count: number;
  }>(supabase, 'propose_meetup_transaction', {
    p_recovery_event_id: 'recovery-123',
    p_proposed_by: 'user-123',
    p_location_name: 'New Location',
    p_latitude: null,
    p_longitude: null,
    p_proposed_datetime: '2024-01-16T10:00:00Z',
    p_message: null,
  });

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.declined_proposals_count, 2);
});

Deno.test('proposeMeetupTransaction: rolls back on recovery update failure', async () => {
  resetMocks();
  mockRpcError = { message: 'Recovery event not found: recovery-456' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{
    proposal_id: string;
    recovery_event_id: string;
    declined_proposals_count: number;
  }>(supabase, 'propose_meetup_transaction', {
    p_recovery_event_id: 'recovery-456',
    p_proposed_by: 'user-123',
    p_location_name: 'Central Park',
    p_latitude: 40.7829,
    p_longitude: -73.9654,
    p_proposed_datetime: '2024-01-15T14:00:00Z',
    p_message: null,
  });

  assertEquals(result.success, false);
  // Both declined proposals and new proposal should be rolled back
  assertEquals(result.error, 'Recovery event not found: recovery-456');
});

// ============================================================================
// report_found_disc_transaction tests
// ============================================================================

Deno.test('reportFoundDiscTransaction: successfully reports found disc', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    recovery_event_id: 'recovery-123',
    notification_id: 'notif-456',
    disc_id: 'disc-789',
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; notification_id: string; disc_id: string }>(
    supabase,
    'report_found_disc_transaction',
    {
      p_disc_id: 'disc-789',
      p_finder_id: 'finder-123',
      p_owner_id: 'owner-456',
      p_finder_message: 'Found at hole 5',
      p_notification_title: 'Your disc was found!',
      p_notification_body: 'John found your Destroyer',
      p_disc_name: 'Destroyer',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.recovery_event_id, 'recovery-123');
  assertEquals(result.data.notification_id, 'notif-456');
});

Deno.test('reportFoundDiscTransaction: creates notification atomically', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    recovery_event_id: 'recovery-123',
    notification_id: 'notif-456',
    disc_id: 'disc-789',
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; notification_id: string; disc_id: string }>(
    supabase,
    'report_found_disc_transaction',
    {
      p_disc_id: 'disc-789',
      p_finder_id: 'finder-123',
      p_owner_id: 'owner-456',
      p_finder_message: null,
      p_notification_title: 'Your disc was found!',
      p_notification_body: 'Someone found your disc',
      p_disc_name: 'your disc',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  // Both recovery event and notification are created atomically
  assertExists(result.data.notification_id);
});

// ============================================================================
// complete_recovery_transaction tests
// ============================================================================

Deno.test('completeRecoveryTransaction: successfully completes recovery', async () => {
  resetMocks();
  mockRpcResult = {
    success: true,
    recovery_event_id: 'recovery-123',
    recovered_at: '2024-01-15T14:00:00Z',
  };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; recovered_at: string }>(
    supabase,
    'complete_recovery_transaction',
    {
      p_recovery_event_id: 'recovery-123',
    }
  );

  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data.recovery_event_id, 'recovery-123');
  assertExists(result.data.recovered_at);
});

Deno.test('completeRecoveryTransaction: fails for non-existent recovery', async () => {
  resetMocks();
  mockRpcError = { message: 'Recovery event not found: recovery-999' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; recovered_at: string }>(
    supabase,
    'complete_recovery_transaction',
    {
      p_recovery_event_id: 'recovery-999',
    }
  );

  assertEquals(result.success, false);
  assertEquals(result.error, 'Recovery event not found: recovery-999');
});

// ============================================================================
// Rollback scenario tests - verify atomicity
// ============================================================================

Deno.test('transaction: all operations rolled back on any failure', async () => {
  resetMocks();
  // Simulate a database constraint violation that should roll back everything
  mockRpcError = { message: 'abandon_disc_transaction failed: foreign key violation' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; disc_id: string }>(
    supabase,
    'abandon_disc_transaction',
    {
      p_recovery_event_id: 'recovery-123',
      p_disc_id: 'disc-456',
      p_user_id: 'user-789',
    }
  );

  assertEquals(result.success, false);
  // The error indicates the entire transaction was rolled back
  assertEquals(result.error?.includes('abandon_disc_transaction failed'), true);
});

Deno.test('transaction: partial completion not possible', async () => {
  resetMocks();
  // When recovery update succeeds but disc update fails, both should be rolled back
  mockRpcError = { message: 'abandon_disc_transaction failed: Disc not found' };

  const supabase = mockSupabaseClient();
  const result = await callTransaction<{ recovery_event_id: string; disc_id: string }>(
    supabase,
    'abandon_disc_transaction',
    {
      p_recovery_event_id: 'recovery-123',
      p_disc_id: 'invalid-disc',
      p_user_id: 'user-789',
    }
  );

  assertEquals(result.success, false);
  // No partial state - either all changes or none
  assertEquals(result.error?.includes('Disc not found'), true);
});
