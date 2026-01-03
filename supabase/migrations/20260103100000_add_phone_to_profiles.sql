-- Add phone number fields to profiles table for visual disc recovery feature
-- Users can optionally add their phone number and allow finders to look them up

-- Add phone_number column (E.164 format: +1XXXXXXXXXX)
ALTER TABLE "public"."profiles"
ADD COLUMN IF NOT EXISTS "phone_number" text;

-- Add phone_discoverable column (opt-in for phone lookup)
ALTER TABLE "public"."profiles"
ADD COLUMN IF NOT EXISTS "phone_discoverable" boolean DEFAULT false NOT NULL;

-- Create partial index for phone number lookups (only on discoverable users)
-- This optimizes lookups while respecting privacy settings
CREATE INDEX IF NOT EXISTS "profiles_phone_discoverable_idx"
ON "public"."profiles"("phone_number")
WHERE phone_discoverable = true AND phone_number IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN "public"."profiles"."phone_number"
IS 'User phone number in E.164 format (+1XXXXXXXXXX) for disc recovery';

COMMENT ON COLUMN "public"."profiles"."phone_discoverable"
IS 'Whether user can be found by phone number written on disc';
