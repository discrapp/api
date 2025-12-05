-- Change photo_type column from enum to text to support UUID-based filenames
-- This allows storing unique photo IDs instead of fixed photo-1, photo-2, etc.

ALTER TABLE disc_photos ALTER COLUMN photo_type TYPE text;

-- Drop the old enum type if it exists and is no longer used
DROP TYPE IF EXISTS photo_type_enum CASCADE;
