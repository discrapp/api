-- Create phone_lookup_logs table for tracking phone number lookups
-- Used for analytics, abuse prevention, and audit trail

CREATE TABLE "public"."phone_lookup_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "finder_id" uuid NOT NULL,
  "searched_phone" text NOT NULL,
  "normalized_phone" text,
  "matched_user_id" uuid,
  "was_discoverable" boolean,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add foreign key constraints
ALTER TABLE "public"."phone_lookup_logs"
ADD CONSTRAINT "phone_lookup_logs_finder_id_fk"
FOREIGN KEY ("finder_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE "public"."phone_lookup_logs"
ADD CONSTRAINT "phone_lookup_logs_matched_user_id_fk"
FOREIGN KEY ("matched_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE "public"."phone_lookup_logs" ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only see their own lookup logs
CREATE POLICY "Users can view own phone lookup logs"
ON "public"."phone_lookup_logs"
FOR SELECT
USING (finder_id = auth.uid());

-- RLS: Service role can insert (API creates logs)
CREATE POLICY "Service role can insert phone lookup logs"
ON "public"."phone_lookup_logs"
FOR INSERT
WITH CHECK (true);

-- Index for rate limiting queries (finder + recent time)
CREATE INDEX "phone_lookup_logs_finder_created_idx"
ON "public"."phone_lookup_logs"("finder_id", "created_at" DESC);

-- Index for admin analytics
CREATE INDEX "phone_lookup_logs_created_idx"
ON "public"."phone_lookup_logs"("created_at" DESC);

-- Comments
COMMENT ON TABLE "public"."phone_lookup_logs"
IS 'Logs phone number lookup attempts for analytics and abuse prevention';

COMMENT ON COLUMN "public"."phone_lookup_logs"."searched_phone"
IS 'The phone number as entered/extracted by finder';

COMMENT ON COLUMN "public"."phone_lookup_logs"."normalized_phone"
IS 'Phone number normalized to E.164 format';

COMMENT ON COLUMN "public"."phone_lookup_logs"."was_discoverable"
IS 'Whether the matched user had phone_discoverable enabled';
