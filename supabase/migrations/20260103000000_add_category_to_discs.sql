-- Add category column to discs table
-- This allows storing disc type (Distance Driver, Midrange, Putter, etc.)
-- when a disc is added from the catalog

ALTER TABLE "public"."discs" ADD COLUMN "category" text;

-- Add index for filtering by category
CREATE INDEX "idx_discs_category" ON "public"."discs"("category");

-- Add comment for documentation
COMMENT ON COLUMN "public"."discs"."category" IS 'Disc type category (Distance Driver, Control Driver, Fairway Driver, Midrange, Putter, etc.)';
