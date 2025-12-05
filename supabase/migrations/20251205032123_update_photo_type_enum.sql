-- Update photo_type enum to support flexible photo slots instead of fixed view types
-- Old values: 'top', 'bottom', 'side'
-- New values: 'photo-1', 'photo-2', 'photo-3', 'photo-4'

-- Add new enum values
ALTER TYPE photo_type ADD VALUE IF NOT EXISTS 'photo-1';
ALTER TYPE photo_type ADD VALUE IF NOT EXISTS 'photo-2';
ALTER TYPE photo_type ADD VALUE IF NOT EXISTS 'photo-3';
ALTER TYPE photo_type ADD VALUE IF NOT EXISTS 'photo-4';

-- Note: We keep the old values (top, bottom, side) for backward compatibility
-- They can be removed in a future migration if needed
