-- Refactor photo storage to use disc_id instead of owner_id in path
-- New structure: {disc_id}/{photo_uuid}.{ext}
-- Old structure: {owner_id}/{disc_id}/{photo_uuid}.{ext}

-- Step 1: Create a function to migrate photos in storage
-- Note: This migration updates the database records. The actual file moves
-- need to be done via a separate script using the Supabase Storage API,
-- as SQL cannot directly move files in storage buckets.

-- Update all disc_photos records to use new path structure
-- Extract disc_id and filename from old path and create new path
UPDATE disc_photos
SET storage_path = CONCAT(
  disc_id::text,
  '/',
  SUBSTRING(storage_path FROM '[^/]+$')  -- Get just the filename
)
WHERE storage_path LIKE '%/%/%';  -- Only update paths with old structure

-- Step 2: Drop old storage policies
DROP POLICY IF EXISTS "Users can upload own disc photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own disc photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can read disc photos they own" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own disc photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own disc photos" ON storage.objects;

-- Step 3: Create new simplified storage policies
-- New path structure: {disc_id}/{filename}

-- Policy: Users can upload photos to discs they own
-- Path structure: {disc_id}/{photo_uuid}.{ext}
CREATE POLICY "Users can upload photos to own discs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'disc-photos' AND
  EXISTS (
    SELECT 1 FROM public.discs
    WHERE discs.id::text = (storage.foldername(name))[1]
    AND discs.owner_id = auth.uid()
  )
);

-- Policy: Users can read photos of discs they own or are involved in recovery
CREATE POLICY "Users can read disc photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'disc-photos' AND
  (
    -- Disc owner can read
    EXISTS (
      SELECT 1 FROM public.discs
      WHERE discs.id::text = (storage.foldername(name))[1]
      AND discs.owner_id = auth.uid()
    )
    OR
    -- Finder or original owner in recovery can read
    EXISTS (
      SELECT 1 FROM public.recovery_events re
      WHERE re.disc_id::text = (storage.foldername(name))[1]
      AND (re.finder_id = auth.uid() OR re.original_owner_id = auth.uid())
    )
  )
);

-- Policy: Users can update photos of discs they own
CREATE POLICY "Users can update photos of own discs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'disc-photos' AND
  EXISTS (
    SELECT 1 FROM public.discs
    WHERE discs.id::text = (storage.foldername(name))[1]
    AND discs.owner_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'disc-photos' AND
  EXISTS (
    SELECT 1 FROM public.discs
    WHERE discs.id::text = (storage.foldername(name))[1]
    AND discs.owner_id = auth.uid()
  )
);

-- Policy: Users can delete photos of discs they own
CREATE POLICY "Users can delete photos of own discs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'disc-photos' AND
  EXISTS (
    SELECT 1 FROM public.discs
    WHERE discs.id::text = (storage.foldername(name))[1]
    AND discs.owner_id = auth.uid()
  )
);
