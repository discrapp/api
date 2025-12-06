-- Rename photo_type column to photo_uuid for clarity
-- The column now stores UUID identifiers instead of type labels
ALTER TABLE disc_photos RENAME COLUMN photo_type TO photo_uuid;
