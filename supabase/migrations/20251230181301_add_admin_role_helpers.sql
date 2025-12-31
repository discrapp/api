-- Add admin role helper functions for RLS policies
-- These functions check the user's role from JWT claims

-- Check if current user has admin role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(
    (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role') = 'admin',
    FALSE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if current user has printer role
CREATE OR REPLACE FUNCTION public.is_printer()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(
    (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role') = 'printer',
    FALSE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Check if current user has admin or printer role
CREATE OR REPLACE FUNCTION public.is_admin_or_printer()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.is_admin() OR public.is_printer();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_printer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_printer() TO authenticated;

-- Update sticker_orders RLS policy to allow admin/printer access
-- First drop existing policy if it exists
DROP POLICY IF EXISTS "Admin and printer can view all orders" ON sticker_orders;

-- Create new policy for admin/printer to view all orders
CREATE POLICY "Admin and printer can view all orders"
  ON sticker_orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin_or_printer()
  );

-- Create policy for admin/printer to update orders
DROP POLICY IF EXISTS "Admin and printer can update orders" ON sticker_orders;

CREATE POLICY "Admin and printer can update orders"
  ON sticker_orders
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_printer())
  WITH CHECK (public.is_admin_or_printer());

-- Allow admin to view all profiles
DROP POLICY IF EXISTS "Admin can view all profiles" ON profiles;

CREATE POLICY "Admin can view all profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid() OR public.is_admin()
  );

-- Allow admin to view all discs
DROP POLICY IF EXISTS "Admin can view all discs" ON discs;

CREATE POLICY "Admin can view all discs"
  ON discs
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid() OR public.is_admin()
  );

-- Allow admin to view all recovery events
DROP POLICY IF EXISTS "Admin can view all recovery events" ON recovery_events;

CREATE POLICY "Admin can view all recovery events"
  ON recovery_events
  FOR SELECT
  TO authenticated
  USING (
    disc_id IN (SELECT id FROM discs WHERE owner_id = auth.uid())
    OR finder_id = auth.uid()
    OR public.is_admin()
  );

-- Allow admin to view all shipping addresses (needed for order fulfillment)
DROP POLICY IF EXISTS "Admin and printer can view shipping addresses" ON shipping_addresses;

CREATE POLICY "Admin and printer can view shipping addresses"
  ON shipping_addresses
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin_or_printer()
  );

-- Allow admin to view AI logs
DROP POLICY IF EXISTS "Admin can view all AI logs" ON ai_identification_logs;

CREATE POLICY "Admin can view all AI logs"
  ON ai_identification_logs
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin()
  );

-- Allow admin to view shot recommendation logs
DROP POLICY IF EXISTS "Admin can view all shot recommendation logs" ON shot_recommendation_logs;

CREATE POLICY "Admin can view all shot recommendation logs"
  ON shot_recommendation_logs
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin()
  );

-- Add comment explaining the role system
COMMENT ON FUNCTION public.is_admin() IS 'Returns true if the current user has the admin role in app_metadata';
COMMENT ON FUNCTION public.is_printer() IS 'Returns true if the current user has the printer role in app_metadata';
COMMENT ON FUNCTION public.is_admin_or_printer() IS 'Returns true if the current user has either admin or printer role';
