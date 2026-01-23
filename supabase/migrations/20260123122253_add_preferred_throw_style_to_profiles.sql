-- Add preferred_throw_style column to profiles table
-- This tracks the user's preferred throwing style (backhand, forehand, or both)
-- Different from throwing_hand which tracks dominant hand

ALTER TABLE profiles
ADD COLUMN preferred_throw_style text DEFAULT 'backhand';

-- Add check constraint to limit values
ALTER TABLE profiles
ADD CONSTRAINT profiles_preferred_throw_style_check
CHECK (preferred_throw_style IN ('backhand', 'forehand', 'both'));

COMMENT ON COLUMN profiles.preferred_throw_style IS 'User preferred throwing style: backhand, forehand, or both';
