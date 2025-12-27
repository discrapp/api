-- Add AI identification reference to discs table
-- This links a disc to its AI identification log entry for tracking and learning

-- Add column to discs table
ALTER TABLE "public"."discs"
ADD COLUMN "ai_identification_log_id" uuid REFERENCES ai_identification_logs(id) ON DELETE SET NULL;

-- Add index for querying AI-identified discs
CREATE INDEX "discs_ai_identification_log_id_idx" ON "public"."discs"("ai_identification_log_id")
WHERE ai_identification_log_id IS NOT NULL;

-- Add disc_id to ai_identification_logs for reverse lookup
ALTER TABLE "public"."ai_identification_logs"
ADD COLUMN "disc_id" uuid REFERENCES discs(id) ON DELETE SET NULL;

-- Add additional correction fields to track all user changes
ALTER TABLE "public"."ai_identification_logs"
ADD COLUMN "ai_color" text,
ADD COLUMN "user_plastic" text,
ADD COLUMN "user_color" text;

-- Comments
COMMENT ON COLUMN "public"."discs"."ai_identification_log_id" IS 'Reference to AI identification log if disc was created using AI identification';
COMMENT ON COLUMN "public"."ai_identification_logs"."disc_id" IS 'Reference to the disc created from this identification (if any)';
