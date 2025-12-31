-- Add database transaction functions for atomic multi-step operations
-- These functions ensure data integrity by wrapping related operations in transactions

-- ============================================================================
-- abandon_disc_transaction
-- Atomically abandons a disc: updates recovery status AND clears disc owner
-- ============================================================================
CREATE OR REPLACE FUNCTION public.abandon_disc_transaction(
  p_recovery_event_id UUID,
  p_disc_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Update recovery event status to abandoned
  UPDATE recovery_events
  SET status = 'abandoned',
      updated_at = NOW()
  WHERE id = p_recovery_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery event not found: %', p_recovery_event_id;
  END IF;

  -- Set disc owner_id to null (making it claimable)
  UPDATE discs
  SET owner_id = NULL,
      updated_at = NOW()
  WHERE id = p_disc_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disc not found: %', p_disc_id;
  END IF;

  v_result := json_build_object(
    'success', true,
    'recovery_event_id', p_recovery_event_id,
    'disc_id', p_disc_id
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    -- Transaction is automatically rolled back
    RAISE EXCEPTION 'abandon_disc_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- claim_disc_transaction
-- Atomically claims a disc: updates disc owner AND closes abandoned recoveries
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_disc_transaction(
  p_disc_id UUID,
  p_user_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_closed_count INTEGER;
BEGIN
  -- Set disc owner_id to the claiming user
  UPDATE discs
  SET owner_id = p_user_id,
      updated_at = NOW()
  WHERE id = p_disc_id
    AND owner_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disc not found or already has owner: %', p_disc_id;
  END IF;

  -- Close any abandoned recovery events for this disc
  UPDATE recovery_events
  SET status = 'recovered',
      recovered_at = NOW(),
      updated_at = NOW()
  WHERE disc_id = p_disc_id
    AND status = 'abandoned';

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;

  v_result := json_build_object(
    'success', true,
    'disc_id', p_disc_id,
    'new_owner_id', p_user_id,
    'closed_recovery_count', v_closed_count
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'claim_disc_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- surrender_disc_transaction
-- Atomically surrenders disc: transfers ownership, updates QR code, updates recovery
-- ============================================================================
CREATE OR REPLACE FUNCTION public.surrender_disc_transaction(
  p_recovery_event_id UUID,
  p_disc_id UUID,
  p_finder_id UUID,
  p_original_owner_id UUID,
  p_qr_code_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Update disc ownership to the finder
  UPDATE discs
  SET owner_id = p_finder_id,
      updated_at = v_now
  WHERE id = p_disc_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disc not found: %', p_disc_id;
  END IF;

  -- Update QR code assignment if provided
  IF p_qr_code_id IS NOT NULL THEN
    UPDATE qr_codes
    SET assigned_to = p_finder_id,
        status = 'active',
        updated_at = v_now
    WHERE id = p_qr_code_id;
  END IF;

  -- Update recovery event status to surrendered
  UPDATE recovery_events
  SET status = 'surrendered',
      surrendered_at = v_now,
      original_owner_id = p_original_owner_id,
      updated_at = v_now
  WHERE id = p_recovery_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery event not found: %', p_recovery_event_id;
  END IF;

  v_result := json_build_object(
    'success', true,
    'recovery_event_id', p_recovery_event_id,
    'disc_id', p_disc_id,
    'new_owner_id', p_finder_id,
    'qr_code_updated', p_qr_code_id IS NOT NULL
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'surrender_disc_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- relinquish_disc_transaction
-- Atomically relinquishes disc: updates recovery status AND transfers ownership
-- ============================================================================
CREATE OR REPLACE FUNCTION public.relinquish_disc_transaction(
  p_recovery_event_id UUID,
  p_disc_id UUID,
  p_finder_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Update recovery event status to abandoned
  UPDATE recovery_events
  SET status = 'abandoned',
      updated_at = v_now
  WHERE id = p_recovery_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery event not found: %', p_recovery_event_id;
  END IF;

  -- Transfer disc ownership to finder
  UPDATE discs
  SET owner_id = p_finder_id,
      updated_at = v_now
  WHERE id = p_disc_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Disc not found: %', p_disc_id;
  END IF;

  v_result := json_build_object(
    'success', true,
    'recovery_event_id', p_recovery_event_id,
    'disc_id', p_disc_id,
    'new_owner_id', p_finder_id
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'relinquish_disc_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- create_drop_off_transaction
-- Atomically creates drop-off: inserts drop_off record AND updates recovery status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_drop_off_transaction(
  p_recovery_event_id UUID,
  p_photo_url TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_location_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_drop_off_id UUID;
  v_result JSON;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Create the drop-off record
  INSERT INTO drop_offs (
    recovery_event_id,
    photo_url,
    latitude,
    longitude,
    location_notes,
    dropped_off_at
  )
  VALUES (
    p_recovery_event_id,
    p_photo_url,
    p_latitude,
    p_longitude,
    p_location_notes,
    v_now
  )
  RETURNING id INTO v_drop_off_id;

  -- Update recovery event status to dropped_off
  UPDATE recovery_events
  SET status = 'dropped_off',
      updated_at = v_now
  WHERE id = p_recovery_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery event not found: %', p_recovery_event_id;
  END IF;

  v_result := json_build_object(
    'success', true,
    'drop_off_id', v_drop_off_id,
    'recovery_event_id', p_recovery_event_id
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'create_drop_off_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- accept_meetup_transaction
-- Atomically accepts meetup: updates proposal status AND recovery event status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.accept_meetup_transaction(
  p_proposal_id UUID,
  p_recovery_event_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Update the proposal status to accepted
  UPDATE meetup_proposals
  SET status = 'accepted'
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meetup proposal not found: %', p_proposal_id;
  END IF;

  -- Update recovery event status to meetup_confirmed
  UPDATE recovery_events
  SET status = 'meetup_confirmed',
      updated_at = v_now
  WHERE id = p_recovery_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery event not found: %', p_recovery_event_id;
  END IF;

  v_result := json_build_object(
    'success', true,
    'proposal_id', p_proposal_id,
    'recovery_event_id', p_recovery_event_id
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'accept_meetup_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- propose_meetup_transaction
-- Atomically proposes meetup: declines existing proposals, creates new, updates recovery
-- ============================================================================
CREATE OR REPLACE FUNCTION public.propose_meetup_transaction(
  p_recovery_event_id UUID,
  p_proposed_by UUID,
  p_location_name TEXT,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_proposed_datetime TIMESTAMPTZ,
  p_message TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_proposal_id UUID;
  v_declined_count INTEGER;
  v_result JSON;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Decline all pending proposals for this recovery
  UPDATE meetup_proposals
  SET status = 'declined'
  WHERE recovery_event_id = p_recovery_event_id
    AND status = 'pending';

  GET DIAGNOSTICS v_declined_count = ROW_COUNT;

  -- Create the new meetup proposal
  INSERT INTO meetup_proposals (
    recovery_event_id,
    proposed_by,
    location_name,
    latitude,
    longitude,
    proposed_datetime,
    status,
    message
  )
  VALUES (
    p_recovery_event_id,
    p_proposed_by,
    p_location_name,
    p_latitude,
    p_longitude,
    p_proposed_datetime,
    'pending',
    p_message
  )
  RETURNING id INTO v_proposal_id;

  -- Update recovery event status to meetup_proposed
  UPDATE recovery_events
  SET status = 'meetup_proposed',
      updated_at = v_now
  WHERE id = p_recovery_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery event not found: %', p_recovery_event_id;
  END IF;

  v_result := json_build_object(
    'success', true,
    'proposal_id', v_proposal_id,
    'recovery_event_id', p_recovery_event_id,
    'declined_proposals_count', v_declined_count
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'propose_meetup_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- report_found_disc_transaction
-- Atomically reports found disc: creates recovery event AND notification
-- ============================================================================
CREATE OR REPLACE FUNCTION public.report_found_disc_transaction(
  p_disc_id UUID,
  p_finder_id UUID,
  p_owner_id UUID,
  p_finder_message TEXT DEFAULT NULL,
  p_notification_title TEXT DEFAULT 'Your disc was found!',
  p_notification_body TEXT DEFAULT 'Someone found your disc',
  p_disc_name TEXT DEFAULT 'your disc'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recovery_event_id UUID;
  v_notification_id UUID;
  v_result JSON;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Create the recovery event
  INSERT INTO recovery_events (
    disc_id,
    finder_id,
    status,
    finder_message,
    found_at
  )
  VALUES (
    p_disc_id,
    p_finder_id,
    'found',
    p_finder_message,
    v_now
  )
  RETURNING id INTO v_recovery_event_id;

  -- Create in-app notification for disc owner
  INSERT INTO notifications (
    user_id,
    type,
    title,
    body,
    data
  )
  VALUES (
    p_owner_id,
    'disc_found',
    p_notification_title,
    p_notification_body,
    json_build_object(
      'recovery_event_id', v_recovery_event_id,
      'disc_id', p_disc_id,
      'finder_id', p_finder_id
    )
  )
  RETURNING id INTO v_notification_id;

  v_result := json_build_object(
    'success', true,
    'recovery_event_id', v_recovery_event_id,
    'notification_id', v_notification_id,
    'disc_id', p_disc_id
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'report_found_disc_transaction failed: %', SQLERRM;
END;
$$;

-- ============================================================================
-- complete_recovery_transaction
-- Atomically completes recovery: updates recovery status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_recovery_transaction(
  p_recovery_event_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Update recovery event status to recovered
  UPDATE recovery_events
  SET status = 'recovered',
      recovered_at = v_now,
      updated_at = v_now
  WHERE id = p_recovery_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recovery event not found: %', p_recovery_event_id;
  END IF;

  v_result := json_build_object(
    'success', true,
    'recovery_event_id', p_recovery_event_id,
    'recovered_at', v_now
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'complete_recovery_transaction failed: %', SQLERRM;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.abandon_disc_transaction(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_disc_transaction(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.surrender_disc_transaction(UUID, UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relinquish_disc_transaction(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_drop_off_transaction(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_meetup_transaction(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_meetup_transaction(UUID, UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_found_disc_transaction(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_recovery_transaction(UUID) TO authenticated;

-- Add comments for documentation
COMMENT ON FUNCTION public.abandon_disc_transaction IS 'Atomically abandons a disc by updating recovery status and clearing disc owner';
COMMENT ON FUNCTION public.claim_disc_transaction IS 'Atomically claims an ownerless disc by setting owner and closing abandoned recoveries';
COMMENT ON FUNCTION public.surrender_disc_transaction IS 'Atomically surrenders disc to finder: transfers ownership, updates QR code, updates recovery';
COMMENT ON FUNCTION public.relinquish_disc_transaction IS 'Atomically relinquishes disc: updates recovery status and transfers ownership to finder';
COMMENT ON FUNCTION public.create_drop_off_transaction IS 'Atomically creates drop-off: inserts record and updates recovery status';
COMMENT ON FUNCTION public.accept_meetup_transaction IS 'Atomically accepts meetup: updates proposal and recovery event status';
COMMENT ON FUNCTION public.propose_meetup_transaction IS 'Atomically proposes meetup: declines existing, creates new, updates recovery';
COMMENT ON FUNCTION public.report_found_disc_transaction IS 'Atomically reports found disc: creates recovery event and notification';
COMMENT ON FUNCTION public.complete_recovery_transaction IS 'Atomically completes recovery: updates status to recovered';
