-- Add dropped_off status to recovery_status enum
ALTER TYPE recovery_status ADD VALUE 'dropped_off';

-- Add disc_dropped_off notification type
ALTER TYPE notification_type ADD VALUE 'disc_dropped_off';

-- Create drop_offs table to store drop-off location details
CREATE TABLE "public"."drop_offs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recovery_event_id" uuid NOT NULL UNIQUE,
  "photo_url" text NOT NULL,
  "latitude" decimal(10, 8) NOT NULL,
  "longitude" decimal(11, 8) NOT NULL,
  "location_notes" text,
  "dropped_off_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retrieved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add foreign key constraint
ALTER TABLE "public"."drop_offs"
  ADD CONSTRAINT "drop_offs_recovery_event_id_fk"
  FOREIGN KEY ("recovery_event_id")
  REFERENCES "public"."recovery_events"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- Enable Row Level Security
ALTER TABLE "public"."drop_offs" ENABLE ROW LEVEL SECURITY;

-- RLS Policies for drop_offs table

-- Owners can view drop-offs for their discs
CREATE POLICY "Owners can view drop-offs for their discs"
  ON "public"."drop_offs"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      JOIN "public"."discs" d ON d.id = re.disc_id
      WHERE re.id = "drop_offs"."recovery_event_id"
      AND d.owner_id = auth.uid()
    )
  );

-- Finders can view drop-offs they created
CREATE POLICY "Finders can view own drop-offs"
  ON "public"."drop_offs"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      WHERE re.id = "drop_offs"."recovery_event_id"
      AND re.finder_id = auth.uid()
    )
  );

-- Only finders can create drop-offs for their recovery events
CREATE POLICY "Finders can create drop-offs"
  ON "public"."drop_offs"
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      WHERE re.id = "drop_offs"."recovery_event_id"
      AND re.finder_id = auth.uid()
      AND re.status = 'found'
    )
  );

-- Owners can update drop-offs (to mark as retrieved)
CREATE POLICY "Owners can update drop-offs"
  ON "public"."drop_offs"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "public"."recovery_events" re
      JOIN "public"."discs" d ON d.id = re.disc_id
      WHERE re.id = "drop_offs"."recovery_event_id"
      AND d.owner_id = auth.uid()
    )
  );

-- Create indexes for performance
CREATE INDEX "drop_offs_recovery_event_id_idx"
  ON "public"."drop_offs"("recovery_event_id");

-- Enable Realtime for drop_offs table
ALTER PUBLICATION supabase_realtime ADD TABLE "public"."drop_offs";

-- Add comments for documentation
COMMENT ON TABLE "public"."drop_offs"
  IS 'Stores drop-off location details when finder leaves disc for owner pickup';
COMMENT ON COLUMN "public"."drop_offs"."photo_url"
  IS 'URL to photo of the drop-off location';
COMMENT ON COLUMN "public"."drop_offs"."latitude"
  IS 'GPS latitude of drop-off location';
COMMENT ON COLUMN "public"."drop_offs"."longitude"
  IS 'GPS longitude of drop-off location';
COMMENT ON COLUMN "public"."drop_offs"."location_notes"
  IS 'Instructions/notes about drop-off location';
COMMENT ON COLUMN "public"."drop_offs"."retrieved_at"
  IS 'Timestamp when owner retrieved the disc';
