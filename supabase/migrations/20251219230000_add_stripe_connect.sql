-- Add Stripe Connect fields to profiles table for reward payouts
-- Allows finders to receive reward payments via credit card

-- Add Stripe Connect account ID
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT UNIQUE;

-- Track Connect account status for UI display
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT DEFAULT NULL
  CHECK (stripe_connect_status IN ('pending', 'active', 'restricted', NULL));

-- Index for quick lookups by Connect account ID
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connect_account_id
ON profiles(stripe_connect_account_id)
WHERE stripe_connect_account_id IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN profiles.stripe_connect_account_id IS 'Stripe Connect Express account ID for receiving reward payments';
COMMENT ON COLUMN profiles.stripe_connect_status IS 'Status of Stripe Connect account: pending (onboarding incomplete), active (can receive payments), restricted (needs attention)';
