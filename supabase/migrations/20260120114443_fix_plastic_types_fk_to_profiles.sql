-- Fix plastic_types FK to reference profiles instead of auth.users
--
-- The admin dashboard query joins submitted_by to get email/full_name,
-- but clients can't query auth.users directly. Changing to reference
-- profiles allows the join to work properly.

-- Drop the existing FK constraint
ALTER TABLE plastic_types
DROP CONSTRAINT IF EXISTS plastic_types_submitted_by_fkey;

-- Add new FK referencing profiles instead of auth.users
ALTER TABLE plastic_types
ADD CONSTRAINT plastic_types_submitted_by_fkey
FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN plastic_types.submitted_by IS 'User who submitted this plastic type (references profiles for queryability)';
