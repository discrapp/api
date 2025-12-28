-- Add throwing_hand preference to profiles table
-- Used for flight path visualization to show correct left/right orientation

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS throwing_hand text
DEFAULT 'right'
CHECK (throwing_hand IN ('right', 'left'));

-- Add comment for documentation
COMMENT ON COLUMN profiles.throwing_hand IS 'User preferred throwing hand (right or left) for flight path visualization';
