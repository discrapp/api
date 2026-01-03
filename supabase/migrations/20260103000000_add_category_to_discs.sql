-- Add category column to discs table
-- This allows storing disc type (Distance Driver, Midrange, Putter, etc.)
-- when a disc is added from the catalog

ALTER TABLE "public"."discs" ADD COLUMN "category" text;

-- Add index for filtering by category
CREATE INDEX "idx_discs_category" ON "public"."discs"("category");

-- Add comment for documentation
COMMENT ON COLUMN "public"."discs"."category" IS 'Disc type category (Distance Driver, Control Driver, Fairway Driver, Midrange, Putter, etc.)';

-- Backfill category for existing discs by matching manufacturer + mold from disc_catalog
UPDATE "public"."discs" d
SET category = dc.category
FROM "public"."disc_catalog" dc
WHERE LOWER(d.manufacturer) = LOWER(dc.manufacturer)
  AND LOWER(d.mold) = LOWER(dc.mold)
  AND dc.category IS NOT NULL
  AND d.category IS NULL;
