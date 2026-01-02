-- Add GPS coordinates to shot_recommendation_logs
-- Enables location-based learning from corrections at the same hole

-- Add GPS columns
ALTER TABLE shot_recommendation_logs
  ADD COLUMN photo_latitude double precision,
  ADD COLUMN photo_longitude double precision;

-- Create spatial index for fast nearby queries
-- Using a B-tree index on both columns for range queries
CREATE INDEX idx_shot_logs_gps
  ON shot_recommendation_logs(photo_latitude, photo_longitude)
  WHERE photo_latitude IS NOT NULL AND photo_longitude IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN shot_recommendation_logs.photo_latitude IS
  'GPS latitude extracted from photo EXIF data';
COMMENT ON COLUMN shot_recommendation_logs.photo_longitude IS
  'GPS longitude extracted from photo EXIF data';
