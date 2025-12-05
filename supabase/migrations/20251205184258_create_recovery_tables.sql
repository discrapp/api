-- Create enums for recovery and meetup statuses
CREATE TYPE "public"."recovery_status" AS ENUM(
  'found',
  'meetup_proposed',
  'meetup_confirmed',
  'recovered',
  'cancelled'
);

CREATE TYPE "public"."meetup_status" AS ENUM(
  'pending',
  'accepted',
  'declined'
);

-- Create recovery_events table
CREATE TABLE "public"."recovery_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "disc_id" uuid NOT NULL,
  "finder_id" uuid NOT NULL,
  "status" "recovery_status" DEFAULT 'found' NOT NULL,
  "finder_message" text,
  "found_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recovered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create meetup_proposals table
CREATE TABLE "public"."meetup_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recovery_event_id" uuid NOT NULL,
  "proposed_by" uuid NOT NULL,
  "location_name" text NOT NULL,
  "latitude" decimal(10, 8),
  "longitude" decimal(11, 8),
  "proposed_datetime" timestamp with time zone NOT NULL,
  "status" "meetup_status" DEFAULT 'pending' NOT NULL,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add foreign key constraints
ALTER TABLE "public"."recovery_events"
  ADD CONSTRAINT "recovery_events_disc_id_fk"
  FOREIGN KEY ("disc_id") REFERENCES "public"."discs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."recovery_events"
  ADD CONSTRAINT "recovery_events_finder_id_fk"
  FOREIGN KEY ("finder_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."meetup_proposals"
  ADD CONSTRAINT "meetup_proposals_recovery_event_id_fk"
  FOREIGN KEY ("recovery_event_id") REFERENCES "public"."recovery_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "public"."meetup_proposals"
  ADD CONSTRAINT "meetup_proposals_proposed_by_fk"
  FOREIGN KEY ("proposed_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Enable Row Level Security
ALTER TABLE "public"."recovery_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."meetup_proposals" ENABLE ROW LEVEL SECURITY;

-- RLS Policies for recovery_events table

-- Owners can view recovery events for their discs
CREATE POLICY "Owners can view recovery events for their discs"
  ON "public"."recovery_events"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "public"."discs"
      WHERE "discs"."id" = "recovery_events"."disc_id"
      AND "discs"."owner_id" = auth.uid()
    )
  );

-- Finders can view recovery events they created
CREATE POLICY "Finders can view own recovery events"
  ON "public"."recovery_events"
  FOR SELECT
  USING (finder_id = auth.uid());

-- Authenticated users can create recovery events (for reporting found discs)
CREATE POLICY "Authenticated users can create recovery events"
  ON "public"."recovery_events"
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND finder_id = auth.uid()
  );

-- Owners and finders can update recovery events
CREATE POLICY "Participants can update recovery events"
  ON "public"."recovery_events"
  FOR UPDATE
  USING (
    finder_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM "public"."discs"
      WHERE "discs"."id" = "recovery_events"."disc_id"
      AND "discs"."owner_id" = auth.uid()
    )
  );

-- RLS Policies for meetup_proposals table

-- Owners can view meetup proposals for their recovery events
CREATE POLICY "Owners can view meetup proposals"
  ON "public"."meetup_proposals"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      JOIN "public"."discs" d ON d.id = re.disc_id
      WHERE re.id = "meetup_proposals"."recovery_event_id"
      AND d.owner_id = auth.uid()
    )
  );

-- Finders can view meetup proposals for their recovery events
CREATE POLICY "Finders can view meetup proposals"
  ON "public"."meetup_proposals"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      WHERE re.id = "meetup_proposals"."recovery_event_id"
      AND re.finder_id = auth.uid()
    )
  );

-- Participants can create meetup proposals
CREATE POLICY "Participants can create meetup proposals"
  ON "public"."meetup_proposals"
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND proposed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      LEFT JOIN "public"."discs" d ON d.id = re.disc_id
      WHERE re.id = "meetup_proposals"."recovery_event_id"
      AND (re.finder_id = auth.uid() OR d.owner_id = auth.uid())
    )
  );

-- Participants can update meetup proposals (for accepting/declining)
CREATE POLICY "Participants can update meetup proposals"
  ON "public"."meetup_proposals"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      LEFT JOIN "public"."discs" d ON d.id = re.disc_id
      WHERE re.id = "meetup_proposals"."recovery_event_id"
      AND (re.finder_id = auth.uid() OR d.owner_id = auth.uid())
    )
  );

-- Create indexes for performance
CREATE INDEX "recovery_events_disc_id_idx" ON "public"."recovery_events"("disc_id");
CREATE INDEX "recovery_events_finder_id_idx" ON "public"."recovery_events"("finder_id");
CREATE INDEX "recovery_events_status_idx" ON "public"."recovery_events"("status");
CREATE INDEX "meetup_proposals_recovery_event_id_idx" ON "public"."meetup_proposals"("recovery_event_id");

-- Enable Realtime for these tables (for notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE "public"."recovery_events";
ALTER PUBLICATION supabase_realtime ADD TABLE "public"."meetup_proposals";

-- Add comments
COMMENT ON TABLE "public"."recovery_events" IS 'Tracks disc recovery events when a finder reports a found disc';
COMMENT ON TABLE "public"."meetup_proposals" IS 'Meetup proposals between disc owners and finders';
COMMENT ON COLUMN "public"."recovery_events"."status" IS 'Current status of the recovery: found, meetup_proposed, meetup_confirmed, recovered, cancelled';
COMMENT ON COLUMN "public"."meetup_proposals"."status" IS 'Status of the meetup proposal: pending, accepted, declined';
