-- Plastic Types: Database of plastic types by manufacturer
-- This powers the plastic dropdown when users add/edit discs

-- Add contributions_count to profiles for tracking community contributions
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS contributions_count integer DEFAULT 0;

COMMENT ON COLUMN public.profiles.contributions_count IS 'Count of approved data contributions (plastic types, etc.)';

-- Main plastic types table
CREATE TABLE plastic_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer text NOT NULL,
  plastic_name text NOT NULL,
  display_order integer DEFAULT 0,
  -- Status: official (seeded/admin-added), approved (user-submitted & approved), pending (awaiting review)
  status text DEFAULT 'official' CHECK (status IN ('official', 'approved', 'pending')),
  submitted_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(manufacturer, plastic_name)
);

-- Indexes for query performance
CREATE INDEX idx_plastic_types_manufacturer ON plastic_types(manufacturer);
CREATE INDEX idx_plastic_types_manufacturer_lower ON plastic_types(lower(manufacturer));
CREATE INDEX idx_plastic_types_status ON plastic_types(status);

-- RLS Policies
ALTER TABLE plastic_types ENABLE ROW LEVEL SECURITY;

-- Anyone can read official and approved plastic types
-- Users can also read their own pending submissions
CREATE POLICY "plastic_types_read_public"
  ON plastic_types
  FOR SELECT
  TO authenticated, anon
  USING (
    status IN ('official', 'approved')
    OR (status = 'pending' AND submitted_by = auth.uid())
  );

-- Authenticated users can submit new plastic types (pending status only)
CREATE POLICY "plastic_types_user_insert"
  ON plastic_types
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND submitted_by = auth.uid()
  );

-- Service role can do everything (for admin approval, seeding, etc.)
CREATE POLICY "plastic_types_service_write"
  ON plastic_types
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_plastic_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plastic_types_updated_at
  BEFORE UPDATE ON plastic_types
  FOR EACH ROW
  EXECUTE FUNCTION update_plastic_types_updated_at();

-- Comments
COMMENT ON TABLE plastic_types IS 'Plastic types by manufacturer for dropdown population (official + crowd-sourced)';
COMMENT ON COLUMN plastic_types.display_order IS 'Order for display in dropdown (lower = first)';
COMMENT ON COLUMN plastic_types.status IS 'official = seeded data, approved = user-submitted & admin-approved, pending = awaiting review';
COMMENT ON COLUMN plastic_types.submitted_by IS 'User who submitted this plastic type (null for official entries)';

-- Seed data: Innova
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Innova', 'Star', 1),
  ('Innova', 'Champion', 2),
  ('Innova', 'GStar', 3),
  ('Innova', 'DX', 4),
  ('Innova', 'Pro', 5),
  ('Innova', 'R-Pro', 6),
  ('Innova', 'KC Pro', 7),
  ('Innova', 'JK Pro', 8),
  ('Innova', 'XT', 9),
  ('Innova', 'Nexus', 10),
  ('Innova', 'Luster', 11),
  ('Innova', 'Metal Flake', 12),
  ('Innova', 'Glow', 13),
  ('Innova', 'Halo Star', 14),
  ('Innova', 'Color Glow', 15),
  ('Innova', 'Blizzard Champion', 16),
  ('Innova', 'Echo Star', 17),
  ('Innova', 'Factory Second', 18);

-- Seed data: Discraft
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Discraft', 'ESP', 1),
  ('Discraft', 'Z', 2),
  ('Discraft', 'Big Z', 3),
  ('Discraft', 'Titanium', 4),
  ('Discraft', 'Jawbreaker', 5),
  ('Discraft', 'Pro-D', 6),
  ('Discraft', 'X', 7),
  ('Discraft', 'Cryztal', 8),
  ('Discraft', 'Cryztal FLX', 9),
  ('Discraft', 'FLX', 10),
  ('Discraft', 'ESP FLX', 11),
  ('Discraft', 'Z FLX', 12),
  ('Discraft', 'Metallic Z', 13),
  ('Discraft', 'Swirl ESP', 14),
  ('Discraft', 'Glo Z', 15),
  ('Discraft', 'Rubber Blend', 16);

-- Seed data: Dynamic Discs
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Dynamic Discs', 'Lucid', 1),
  ('Dynamic Discs', 'Fuzion', 2),
  ('Dynamic Discs', 'Prime', 3),
  ('Dynamic Discs', 'Classic', 4),
  ('Dynamic Discs', 'Lucid-X', 5),
  ('Dynamic Discs', 'Fuzion-X', 6),
  ('Dynamic Discs', 'Lucid Air', 7),
  ('Dynamic Discs', 'Moonshine', 8),
  ('Dynamic Discs', 'Chameleon', 9),
  ('Dynamic Discs', 'Fluid', 10);

-- Seed data: Latitude 64
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Latitude 64', 'Opto', 1),
  ('Latitude 64', 'Gold', 2),
  ('Latitude 64', 'Retro', 3),
  ('Latitude 64', 'Zero', 4),
  ('Latitude 64', 'Opto-X', 5),
  ('Latitude 64', 'Gold-X', 6),
  ('Latitude 64', 'Opto Air', 7),
  ('Latitude 64', 'Frost', 8),
  ('Latitude 64', 'Moonshine', 9),
  ('Latitude 64', 'Opto Glimmer', 10),
  ('Latitude 64', 'Royal', 11),
  ('Latitude 64', 'Grand', 12);

-- Seed data: Westside
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Westside', 'VIP', 1),
  ('Westside', 'Tournament', 2),
  ('Westside', 'Origio', 3),
  ('Westside', 'BT', 4),
  ('Westside', 'VIP-X', 5),
  ('Westside', 'Tournament-X', 6),
  ('Westside', 'VIP Air', 7),
  ('Westside', 'Moonshine', 8),
  ('Westside', 'Elasto', 9);

-- Seed data: MVP
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('MVP', 'Neutron', 1),
  ('MVP', 'Proton', 2),
  ('MVP', 'Electron', 3),
  ('MVP', 'Plasma', 4),
  ('MVP', 'Fission', 5),
  ('MVP', 'Cosmic Neutron', 6),
  ('MVP', 'Cosmic Electron', 7),
  ('MVP', 'Eclipse', 8),
  ('MVP', 'Total Eclipse', 9);

-- Seed data: Axiom
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Axiom', 'Neutron', 1),
  ('Axiom', 'Proton', 2),
  ('Axiom', 'Electron', 3),
  ('Axiom', 'Plasma', 4),
  ('Axiom', 'Fission', 5),
  ('Axiom', 'Cosmic Neutron', 6),
  ('Axiom', 'Cosmic Electron', 7),
  ('Axiom', 'Eclipse', 8),
  ('Axiom', 'Total Eclipse', 9);

-- Seed data: Streamline
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Streamline', 'Neutron', 1),
  ('Streamline', 'Proton', 2),
  ('Streamline', 'Electron', 3),
  ('Streamline', 'Plasma', 4),
  ('Streamline', 'Cosmic Neutron', 5),
  ('Streamline', 'Cosmic Electron', 6);

-- Seed data: Thought Space Athletics
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Thought Space Athletics', 'Aura', 1),
  ('Thought Space Athletics', 'Ethos', 2),
  ('Thought Space Athletics', 'Nerve', 3),
  ('Thought Space Athletics', 'Synapse', 4),
  ('Thought Space Athletics', 'Origin', 5),
  ('Thought Space Athletics', 'Ethereal', 6),
  ('Thought Space Athletics', 'Glow', 7);

-- Seed data: Discmania
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Discmania', 'S-Line', 1),
  ('Discmania', 'C-Line', 2),
  ('Discmania', 'P-Line', 3),
  ('Discmania', 'D-Line', 4),
  ('Discmania', 'G-Line', 5),
  ('Discmania', 'Neo', 6),
  ('Discmania', 'Evolution', 7),
  ('Discmania', 'Exo', 8),
  ('Discmania', 'Lux', 9),
  ('Discmania', 'Horizon', 10),
  ('Discmania', 'Forge', 11),
  ('Discmania', 'Vapor', 12);

-- Seed data: Kastaplast
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Kastaplast', 'K1', 1),
  ('Kastaplast', 'K1 Soft', 2),
  ('Kastaplast', 'K1 Glow', 3),
  ('Kastaplast', 'K2', 4),
  ('Kastaplast', 'K3', 5),
  ('Kastaplast', 'K3 Hard', 6);

-- Seed data: Prodigy
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Prodigy', '400', 1),
  ('Prodigy', '400G', 2),
  ('Prodigy', '400S', 3),
  ('Prodigy', '350G', 4),
  ('Prodigy', '350', 5),
  ('Prodigy', '300', 6),
  ('Prodigy', '300 Soft', 7),
  ('Prodigy', '200', 8),
  ('Prodigy', '500', 9),
  ('Prodigy', '750', 10),
  ('Prodigy', '750G', 11),
  ('Prodigy', 'Pro Flex', 12);

-- Seed data: Infinite Discs
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Infinite Discs', 'I-Blend', 1),
  ('Infinite Discs', 'S-Blend', 2),
  ('Infinite Discs', 'C-Blend', 3),
  ('Infinite Discs', 'D-Blend', 4),
  ('Infinite Discs', 'G-Blend', 5),
  ('Infinite Discs', 'Metal Flake', 6),
  ('Infinite Discs', 'Glow', 7),
  ('Infinite Discs', 'Swirl S-Blend', 8);

-- Seed data: Legacy
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Legacy', 'Icon', 1),
  ('Legacy', 'Pinnacle', 2),
  ('Legacy', 'Excel', 3),
  ('Legacy', 'Protege', 4),
  ('Legacy', 'Gravity', 5);

-- Seed data: Gateway
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Gateway', 'Diamond', 1),
  ('Gateway', 'Platinum', 2),
  ('Gateway', 'Suregrip', 3),
  ('Gateway', 'Eraser', 4),
  ('Gateway', 'Organic', 5),
  ('Gateway', 'Evolution', 6),
  ('Gateway', 'Hyper Diamond', 7);

-- Seed data: DGA
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('DGA', 'Proline', 1),
  ('DGA', 'SP Line', 2),
  ('DGA', 'D-Line', 3),
  ('DGA', 'Signature', 4),
  ('DGA', 'Glow', 5);

-- Seed data: Clash Discs
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Clash Discs', 'Steady', 1),
  ('Clash Discs', 'Hardy', 2),
  ('Clash Discs', 'Softy', 3);

-- Seed data: Mint Discs
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Mint Discs', 'Apex', 1),
  ('Mint Discs', 'Sublime', 2),
  ('Mint Discs', 'Eternal', 3),
  ('Mint Discs', 'Royal', 4);

-- Seed data: Loft
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Loft', 'Alpha-Solid', 1),
  ('Loft', 'Beta-Solid', 2),
  ('Loft', 'Gamma-Solid', 3);

-- Seed data: RPM
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('RPM', 'Atomic', 1),
  ('RPM', 'Cosmic', 2),
  ('RPM', 'Strata', 3),
  ('RPM', 'Magma', 4);

-- Seed data: Viking Discs
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Viking Discs', 'Storm', 1),
  ('Viking Discs', 'Armor', 2),
  ('Viking Discs', 'Ground', 3);

-- Seed data: Yikun
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Yikun', 'Dragon', 1),
  ('Yikun', 'Phoenix', 2),
  ('Yikun', 'Tiger', 3);

-- Seed data: Divergent Discs
INSERT INTO plastic_types (manufacturer, plastic_name, display_order) VALUES
  ('Divergent Discs', 'Max Grip', 1),
  ('Divergent Discs', 'Stayput', 2);

-- Function to handle plastic type approval
-- Increments user's contribution count and creates a notification
CREATE OR REPLACE FUNCTION handle_plastic_type_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when status changes to 'approved' and there's a submitter
  IF NEW.status = 'approved' AND OLD.status = 'pending' AND NEW.submitted_by IS NOT NULL THEN
    -- Increment the user's contribution count
    UPDATE public.profiles
    SET contributions_count = COALESCE(contributions_count, 0) + 1
    WHERE id = NEW.submitted_by;

    -- Create a notification for the user
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      NEW.submitted_by,
      'contribution_approved',
      'Plastic Type Approved!',
      'Your submitted plastic type "' || NEW.plastic_name || '" for ' || NEW.manufacturer || ' has been approved. Thanks for contributing!',
      jsonb_build_object(
        'plastic_type_id', NEW.id,
        'manufacturer', NEW.manufacturer,
        'plastic_name', NEW.plastic_name
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_plastic_type_approved
  AFTER UPDATE ON plastic_types
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION handle_plastic_type_approval();
