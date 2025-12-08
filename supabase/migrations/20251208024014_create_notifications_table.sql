-- Create notification type enum
CREATE TYPE "notification_type" AS ENUM (
  'disc_found',
  'meetup_proposed',
  'meetup_accepted',
  'meetup_declined',
  'disc_recovered'
);

-- Create notifications table
CREATE TABLE "public"."notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."profiles"("id") ON DELETE CASCADE,
  "type" "notification_type" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "data" jsonb DEFAULT '{}',
  "read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes for efficient queries
CREATE INDEX "notifications_user_id_idx" ON "public"."notifications" ("user_id");
CREATE INDEX "notifications_user_id_read_idx" ON "public"."notifications" ("user_id", "read");
CREATE INDEX "notifications_created_at_idx" ON "public"."notifications" ("created_at" DESC);

-- Enable RLS
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own notifications
CREATE POLICY "Users can view own notifications"
  ON "public"."notifications"
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON "public"."notifications"
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Only allow service role to insert notifications (edge functions)
CREATE POLICY "Service role can insert notifications"
  ON "public"."notifications"
  FOR INSERT
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE "public"."notifications" IS 'In-app notifications for users';
COMMENT ON COLUMN "public"."notifications"."type" IS 'Type of notification event';
COMMENT ON COLUMN "public"."notifications"."data" IS 'Additional data like recovery_event_id, disc_id, etc.';
