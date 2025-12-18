-- Disc Catalog: Comprehensive database of disc golf discs with flight numbers
-- This powers autocomplete functionality when users add discs

-- Main disc catalog table
CREATE TABLE disc_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core disc information
  manufacturer text NOT NULL,
  mold text NOT NULL,
  category text, -- 'Distance Driver', 'Control Driver', 'Hybrid Driver', 'Midrange', 'Putter', 'Approach Discs'

  -- Flight numbers
  speed numeric(3,1),
  glide numeric(3,1),
  turn numeric(3,1),
  fade numeric(3,1),
  stability text, -- 'Very Overstable', 'Overstable', 'Stable', 'Understable', 'Very Understable'

  -- Verification and source tracking
  status text DEFAULT 'verified' CHECK (status IN ('verified', 'user_submitted', 'rejected')),
  submitted_by uuid REFERENCES auth.users(id),
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id),

  -- Sync tracking for automated updates
  source text, -- 'discit_api', 'manual', 'user'
  source_id text, -- External ID from source (e.g., DiscIt UUID)
  source_url text,
  last_synced_at timestamptz,

  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Prevent duplicate entries
  UNIQUE(manufacturer, mold)
);

-- Indexes for search performance
CREATE INDEX idx_disc_catalog_mold_search ON disc_catalog USING gin(to_tsvector('english', mold));
CREATE INDEX idx_disc_catalog_manufacturer_search ON disc_catalog USING gin(to_tsvector('english', manufacturer));
CREATE INDEX idx_disc_catalog_mold_lower ON disc_catalog(lower(mold));
CREATE INDEX idx_disc_catalog_manufacturer_lower ON disc_catalog(lower(manufacturer));
CREATE INDEX idx_disc_catalog_status ON disc_catalog(status);
CREATE INDEX idx_disc_catalog_category ON disc_catalog(category);
CREATE INDEX idx_disc_catalog_source_id ON disc_catalog(source, source_id);

-- Sync log for tracking automated updates
CREATE TABLE disc_catalog_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  source text NOT NULL,
  discs_added integer DEFAULT 0,
  discs_updated integer DEFAULT 0,
  discs_unchanged integer DEFAULT 0,
  errors jsonb,
  status text DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed'))
);

-- RLS Policies
ALTER TABLE disc_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE disc_catalog_sync_log ENABLE ROW LEVEL SECURITY;

-- Anyone can read the disc catalog (for autocomplete)
CREATE POLICY "disc_catalog_read_all"
  ON disc_catalog
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Only service role can insert/update/delete (via edge functions)
CREATE POLICY "disc_catalog_service_write"
  ON disc_catalog
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Sync log is read-only for authenticated users (admin dashboard)
CREATE POLICY "disc_catalog_sync_log_read"
  ON disc_catalog_sync_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "disc_catalog_sync_log_service_write"
  ON disc_catalog_sync_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_disc_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER disc_catalog_updated_at
  BEFORE UPDATE ON disc_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_disc_catalog_updated_at();

-- Comments
COMMENT ON TABLE disc_catalog IS 'Comprehensive disc golf disc database for autocomplete and flight number lookup';
COMMENT ON COLUMN disc_catalog.source IS 'Data source: discit_api (DiscIt API sync), manual (admin entry), user (user submission)';
COMMENT ON COLUMN disc_catalog.source_id IS 'External identifier from the data source for deduplication during sync';
COMMENT ON COLUMN disc_catalog.status IS 'verified = confirmed data, user_submitted = pending review, rejected = not valid';
