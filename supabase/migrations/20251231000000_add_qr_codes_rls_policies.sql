-- Add RLS policies to qr_codes table
-- The table has RLS enabled but no policies, blocking all access

-- Allow users to read QR codes linked to their discs
CREATE POLICY "Users can read own qr_codes"
  ON "public"."qr_codes"
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT qr_code_id FROM discs WHERE owner_id = auth.uid())
    OR public.is_admin()
  );

-- Allow service role to manage QR codes (for order fulfillment)
CREATE POLICY "Service role can manage qr_codes"
  ON "public"."qr_codes"
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
