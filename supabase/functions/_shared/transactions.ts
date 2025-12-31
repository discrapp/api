import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Transaction utilities for atomic database operations
 *
 * These functions call PostgreSQL stored procedures that wrap multi-step
 * operations in transactions, ensuring all-or-nothing behavior.
 */

export type TransactionResult<T = Record<string, unknown>> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * Abandon disc transaction
 * Atomically: updates recovery status to 'abandoned' AND clears disc owner
 */
export async function abandonDiscTransaction(
  supabase: SupabaseClient,
  params: {
    recoveryEventId: string;
    discId: string;
    userId: string;
  }
): Promise<TransactionResult<{ recovery_event_id: string; disc_id: string }>> {
  const { data, error } = await supabase.rpc('abandon_disc_transaction', {
    p_recovery_event_id: params.recoveryEventId,
    p_disc_id: params.discId,
    p_user_id: params.userId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Claim disc transaction
 * Atomically: sets disc owner AND closes abandoned recovery events
 */
export async function claimDiscTransaction(
  supabase: SupabaseClient,
  params: {
    discId: string;
    userId: string;
  }
): Promise<TransactionResult<{ disc_id: string; new_owner_id: string; closed_recovery_count: number }>> {
  const { data, error } = await supabase.rpc('claim_disc_transaction', {
    p_disc_id: params.discId,
    p_user_id: params.userId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Surrender disc transaction
 * Atomically: transfers ownership, updates QR code, updates recovery status
 */
export async function surrenderDiscTransaction(
  supabase: SupabaseClient,
  params: {
    recoveryEventId: string;
    discId: string;
    finderId: string;
    originalOwnerId: string;
    qrCodeId?: string | null;
  }
): Promise<
  TransactionResult<{
    recovery_event_id: string;
    disc_id: string;
    new_owner_id: string;
    qr_code_updated: boolean;
  }>
> {
  const { data, error } = await supabase.rpc('surrender_disc_transaction', {
    p_recovery_event_id: params.recoveryEventId,
    p_disc_id: params.discId,
    p_finder_id: params.finderId,
    p_original_owner_id: params.originalOwnerId,
    p_qr_code_id: params.qrCodeId || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Relinquish disc transaction
 * Atomically: updates recovery status AND transfers ownership to finder
 */
export async function relinquishDiscTransaction(
  supabase: SupabaseClient,
  params: {
    recoveryEventId: string;
    discId: string;
    finderId: string;
  }
): Promise<TransactionResult<{ recovery_event_id: string; disc_id: string; new_owner_id: string }>> {
  const { data, error } = await supabase.rpc('relinquish_disc_transaction', {
    p_recovery_event_id: params.recoveryEventId,
    p_disc_id: params.discId,
    p_finder_id: params.finderId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Create drop-off transaction
 * Atomically: creates drop-off record AND updates recovery status
 */
export async function createDropOffTransaction(
  supabase: SupabaseClient,
  params: {
    recoveryEventId: string;
    photoUrl: string;
    latitude: number;
    longitude: number;
    locationNotes?: string | null;
  }
): Promise<TransactionResult<{ drop_off_id: string; recovery_event_id: string }>> {
  const { data, error } = await supabase.rpc('create_drop_off_transaction', {
    p_recovery_event_id: params.recoveryEventId,
    p_photo_url: params.photoUrl,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
    p_location_notes: params.locationNotes || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Accept meetup transaction
 * Atomically: updates proposal status AND recovery event status
 */
export async function acceptMeetupTransaction(
  supabase: SupabaseClient,
  params: {
    proposalId: string;
    recoveryEventId: string;
  }
): Promise<TransactionResult<{ proposal_id: string; recovery_event_id: string }>> {
  const { data, error } = await supabase.rpc('accept_meetup_transaction', {
    p_proposal_id: params.proposalId,
    p_recovery_event_id: params.recoveryEventId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Propose meetup transaction
 * Atomically: declines existing proposals, creates new proposal, updates recovery
 */
export async function proposeMeetupTransaction(
  supabase: SupabaseClient,
  params: {
    recoveryEventId: string;
    proposedBy: string;
    locationName: string;
    latitude?: number | null;
    longitude?: number | null;
    proposedDatetime: string;
    message?: string | null;
  }
): Promise<
  TransactionResult<{
    proposal_id: string;
    recovery_event_id: string;
    declined_proposals_count: number;
  }>
> {
  const { data, error } = await supabase.rpc('propose_meetup_transaction', {
    p_recovery_event_id: params.recoveryEventId,
    p_proposed_by: params.proposedBy,
    p_location_name: params.locationName,
    p_latitude: params.latitude || null,
    p_longitude: params.longitude || null,
    p_proposed_datetime: params.proposedDatetime,
    p_message: params.message || null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Report found disc transaction
 * Atomically: creates recovery event AND notification
 */
export async function reportFoundDiscTransaction(
  supabase: SupabaseClient,
  params: {
    discId: string;
    finderId: string;
    ownerId: string;
    finderMessage?: string | null;
    notificationTitle?: string;
    notificationBody?: string;
    discName?: string;
  }
): Promise<TransactionResult<{ recovery_event_id: string; notification_id: string; disc_id: string }>> {
  const { data, error } = await supabase.rpc('report_found_disc_transaction', {
    p_disc_id: params.discId,
    p_finder_id: params.finderId,
    p_owner_id: params.ownerId,
    p_finder_message: params.finderMessage || null,
    p_notification_title: params.notificationTitle || 'Your disc was found!',
    p_notification_body: params.notificationBody || 'Someone found your disc',
    p_disc_name: params.discName || 'your disc',
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * Complete recovery transaction
 * Atomically: updates recovery status to recovered
 */
export async function completeRecoveryTransaction(
  supabase: SupabaseClient,
  params: {
    recoveryEventId: string;
  }
): Promise<TransactionResult<{ recovery_event_id: string; recovered_at: string }>> {
  const { data, error } = await supabase.rpc('complete_recovery_transaction', {
    p_recovery_event_id: params.recoveryEventId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data };
}
