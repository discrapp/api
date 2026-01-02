-- Disc Recommendation Logs: Tracks AI-powered disc recommendations for users
-- This powers the "Fill the Bag" feature and provides analytics for admin dashboard

-- Main recommendation logs table
CREATE TABLE disc_recommendation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User who requested the recommendation
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Request parameters
  request_count integer NOT NULL CHECK (request_count IN (1, 3, 5)),

  -- Bag analysis at time of request (JSON snapshot)
  bag_analysis jsonb NOT NULL,

  -- AI recommendations returned
  recommendations jsonb NOT NULL,

  -- AI response metadata
  ai_raw_response jsonb,
  confidence numeric(3,2),
  processing_time_ms integer,
  model_version text,

  -- Timestamps
  created_at timestamptz DEFAULT now()
);

-- Indexes for query performance
CREATE INDEX idx_disc_recommendation_logs_user_id
  ON disc_recommendation_logs(user_id);
CREATE INDEX idx_disc_recommendation_logs_created_at
  ON disc_recommendation_logs(created_at DESC);
CREATE INDEX idx_disc_recommendation_logs_request_count
  ON disc_recommendation_logs(request_count);

-- RLS Policies
ALTER TABLE disc_recommendation_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own recommendation logs
CREATE POLICY "users_read_own_recommendation_logs"
  ON disc_recommendation_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role can write (via edge functions)
CREATE POLICY "service_role_write_recommendation_logs"
  ON disc_recommendation_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comments for documentation
COMMENT ON TABLE disc_recommendation_logs IS 'Stores AI-generated disc recommendations for the Fill the Bag feature';
COMMENT ON COLUMN disc_recommendation_logs.request_count IS 'Number of recommendations requested: 1, 3, or 5';
COMMENT ON COLUMN disc_recommendation_logs.bag_analysis IS 'Snapshot of user bag analysis at request time: brand/plastic preferences, speed coverage, stability gaps';
COMMENT ON COLUMN disc_recommendation_logs.recommendations IS 'Array of recommended discs with reasons and affiliate links';
COMMENT ON COLUMN disc_recommendation_logs.confidence IS 'AI confidence score (0.00 to 1.00)';
