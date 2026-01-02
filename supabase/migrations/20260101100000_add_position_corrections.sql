-- Add position correction columns to shot_recommendation_logs
-- Allows users to correct AI-estimated tee and basket positions for training

-- Add correction columns
ALTER TABLE shot_recommendation_logs
  ADD COLUMN corrected_tee_position jsonb,
  ADD COLUMN corrected_basket_position jsonb,
  ADD COLUMN correction_submitted_at timestamptz;

-- Add comment for documentation
COMMENT ON COLUMN shot_recommendation_logs.corrected_tee_position IS
  'User-corrected tee position {x: 0-100, y: 0-100} for training data';
COMMENT ON COLUMN shot_recommendation_logs.corrected_basket_position IS
  'User-corrected basket position {x: 0-100, y: 0-100} for training data';
COMMENT ON COLUMN shot_recommendation_logs.correction_submitted_at IS
  'Timestamp when user submitted position corrections';

-- Index for finding uncorrected vs corrected recommendations
CREATE INDEX idx_shot_logs_corrected
  ON shot_recommendation_logs(correction_submitted_at)
  WHERE correction_submitted_at IS NOT NULL;
