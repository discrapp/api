-- Fix: Allow owner_id to be NULL for abandoned discs
-- Issue #235: When a disc is abandoned, the owner_id should be set to NULL
-- to indicate that the disc no longer has an owner and can be claimed

-- Drop NOT NULL constraint from owner_id column
ALTER TABLE "public"."discs" ALTER COLUMN "owner_id" DROP NOT NULL;

-- Add comment explaining the nullable owner_id
COMMENT ON COLUMN "public"."discs"."owner_id" IS 'Owner of the disc. NULL indicates an abandoned disc that can be claimed.';
