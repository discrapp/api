-- Fix plastic_types RLS policy to allow admins to see all records
-- Previously, admins could only see official/approved plastics or their own pending submissions
-- This update allows admin users to see ALL plastic types including pending submissions from other users

-- Drop the existing read policy
DROP POLICY IF EXISTS "plastic_types_read_public" ON plastic_types;

-- Create updated policy that includes admin access
CREATE POLICY "plastic_types_read_public"
  ON plastic_types
  FOR SELECT
  TO authenticated, anon
  USING (
    status IN ('official', 'approved')
    OR (status = 'pending' AND submitted_by = auth.uid())
    OR public.is_admin()
  );

COMMENT ON POLICY "plastic_types_read_public" ON plastic_types IS
  'Anyone can read official/approved plastics. Users can read their own pending submissions. Admins can read all records.';
