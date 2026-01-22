-- Fix plastic type approval trigger
-- The trigger was using 'message' column but notifications table has 'body'
-- Also need to add 'contribution_approved' to the notification_type enum

-- Add the new notification type
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'contribution_approved';

-- Recreate the function with the correct column name
CREATE OR REPLACE FUNCTION handle_plastic_type_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when status changes to 'approved' and there's a submitter
  IF NEW.status = 'approved' AND OLD.status = 'pending' AND NEW.submitted_by IS NOT NULL THEN
    -- Increment the user's contribution count
    UPDATE public.profiles
    SET contributions_count = COALESCE(contributions_count, 0) + 1
    WHERE id = NEW.submitted_by;

    -- Create a notification for the user (using 'body' not 'message')
    INSERT INTO public.notifications (user_id, type, title, body, data)
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

-- Add comment for documentation
COMMENT ON FUNCTION handle_plastic_type_approval() IS 'Handles plastic type approval: increments contribution count and creates notification';
