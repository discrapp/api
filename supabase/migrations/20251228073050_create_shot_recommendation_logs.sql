-- Shot Recommendation Logs: Track AI shot analysis and disc recommendations
-- This table stores the results of AI-powered shot recommendations for analytics,
-- debugging, and future model improvement.

CREATE TABLE shot_recommendation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User context
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- AI analysis results
  ai_estimated_distance_ft integer,
  ai_confidence numeric(3,2) CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_terrain_analysis jsonb,
  ai_raw_response jsonb,

  -- Recommendation results
  recommended_disc_id uuid REFERENCES discs(id) ON DELETE SET NULL,
  recommended_throw_type text CHECK (recommended_throw_type IN ('hyzer', 'flat', 'anhyzer')),
  recommended_power_percentage integer CHECK (
    recommended_power_percentage >= 0 AND recommended_power_percentage <= 100
  ),
  recommended_line_description text,

  -- Alternative recommendations stored as JSON array
  alternative_recommendations jsonb,

  -- Performance tracking
  processing_time_ms integer,
  model_version text DEFAULT 'claude-sonnet-4-20250514',

  -- Timestamps
  created_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_shot_logs_user ON shot_recommendation_logs(user_id);
CREATE INDEX idx_shot_logs_created ON shot_recommendation_logs(created_at DESC);
CREATE INDEX idx_shot_logs_disc ON shot_recommendation_logs(recommended_disc_id);

-- Enable Row Level Security
ALTER TABLE shot_recommendation_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own recommendation logs
CREATE POLICY "shot_logs_read_own"
  ON shot_recommendation_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role has full access for edge functions to insert logs
CREATE POLICY "shot_logs_service_all"
  ON shot_recommendation_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE shot_recommendation_logs IS
  'Stores AI shot recommendation results for analytics and debugging';
