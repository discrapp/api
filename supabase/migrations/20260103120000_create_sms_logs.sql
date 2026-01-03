-- Create sms_logs table for tracking SMS invites
-- Used for rate limiting (1 SMS per number per 24h) and audit trail

CREATE TABLE "public"."sms_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sender_id" uuid NOT NULL,
  "recipient_phone" text NOT NULL,
  "message_type" text NOT NULL,
  "twilio_sid" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add foreign key constraint
ALTER TABLE "public"."sms_logs"
ADD CONSTRAINT "sms_logs_sender_id_fk"
FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE "public"."sms_logs" ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only see their own SMS logs
CREATE POLICY "Users can view own sms logs"
ON "public"."sms_logs"
FOR SELECT
USING (sender_id = auth.uid());

-- RLS: Service role can insert (API creates logs)
CREATE POLICY "Service role can insert sms logs"
ON "public"."sms_logs"
FOR INSERT
WITH CHECK (true);

-- Index for rate limiting queries (recipient + recent time)
CREATE INDEX "sms_logs_recipient_sent_idx"
ON "public"."sms_logs"("recipient_phone", "sent_at" DESC);

-- Index for admin analytics
CREATE INDEX "sms_logs_sent_idx"
ON "public"."sms_logs"("sent_at" DESC);

-- Comments
COMMENT ON TABLE "public"."sms_logs"
IS 'Logs SMS messages sent for disc recovery invites';

COMMENT ON COLUMN "public"."sms_logs"."message_type"
IS 'Type of message: disc_found_invite';

COMMENT ON COLUMN "public"."sms_logs"."twilio_sid"
IS 'Twilio message SID for tracking delivery';
