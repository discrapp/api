-- Fix race condition in order number generation (Issue #226)
--
-- The previous implementation used MAX(order_number) to find the next sequence
-- number. This creates a race condition where concurrent transactions can both
-- read the same MAX value and generate duplicate order numbers.
--
-- This migration replaces the MAX-based approach with a PostgreSQL sequence,
-- which provides atomic incrementing that is safe for concurrent access.

-- Create sequence for order numbers (global, not per-day)
-- Using a global sequence is simpler and avoids race conditions entirely.
-- The date is still included in the order number for readability.
CREATE SEQUENCE IF NOT EXISTS sticker_order_number_seq START WITH 1;

-- Initialize sequence to the current maximum sequence number from existing orders
-- This ensures we don't generate duplicate order numbers
DO $$
DECLARE
  max_seq INTEGER;
BEGIN
  -- Find the maximum sequence number across all existing orders
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(order_number, '-', 3) AS INTEGER)
  ), 0)
  INTO max_seq
  FROM sticker_orders
  WHERE order_number ~ '^AB-\d{8}-\d{4}$';

  -- Set the sequence to start after the current maximum
  IF max_seq > 0 THEN
    PERFORM setval('sticker_order_number_seq', max_seq);
  END IF;
END $$;

-- Replace the order number generation function to use the sequence
-- The sequence provides atomic incrementing that prevents race conditions
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  date_part TEXT;
  seq_num INTEGER;
  order_num TEXT;
BEGIN
  date_part := to_char(now(), 'YYYYMMDD');

  -- Get next value from sequence atomically (thread-safe)
  seq_num := nextval('sticker_order_number_seq');

  order_num := 'AB-' || date_part || '-' || LPAD(seq_num::TEXT, 4, '0');

  RETURN order_num;
END;
$$ LANGUAGE plpgsql;

-- Add comment documenting the fix
COMMENT ON FUNCTION generate_order_number() IS
  'Generates unique order numbers using a PostgreSQL sequence for atomic '
  'incrementing. Format: AB-YYYYMMDD-NNNN where NNNN is a globally unique '
  'sequence number. Fixed race condition in Issue #226.';

COMMENT ON SEQUENCE sticker_order_number_seq IS
  'Sequence for generating unique sticker order numbers. Provides atomic '
  'incrementing to prevent duplicate order numbers under concurrent load.';
