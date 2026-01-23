-- Create dismissed_disc_recommendations table
-- Stores user dismissals of disc recommendations so they won't be suggested again

CREATE TABLE dismissed_disc_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  disc_catalog_id uuid REFERENCES disc_catalog(id) ON DELETE CASCADE NOT NULL,
  dismissed_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, disc_catalog_id)
);

-- Create index for efficient user-based queries
CREATE INDEX idx_dismissed_disc_recommendations_user_id ON dismissed_disc_recommendations(user_id);

-- Enable RLS
ALTER TABLE dismissed_disc_recommendations ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own dismissals"
  ON dismissed_disc_recommendations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dismissals"
  ON dismissed_disc_recommendations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own dismissals"
  ON dismissed_disc_recommendations FOR DELETE
  USING (auth.uid() = user_id);

-- Add comment for documentation
COMMENT ON TABLE dismissed_disc_recommendations IS 'Stores disc recommendations that users have dismissed so they are not suggested again';
