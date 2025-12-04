-- Create storage bucket for disc photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'disc-photos',
  'disc-photos',
  false, -- Private bucket
  5242880, -- 5MB in bytes
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Note: RLS is already enabled on storage.objects by default in Supabase
-- No need to enable it manually

-- Policy: Users can upload photos to their own folder
-- Path structure: {user_id}/{disc_id}/{photo_type}.jpg
CREATE POLICY "Users can upload own disc photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'disc-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text AND
  EXISTS (
    SELECT 1 FROM public.discs
    WHERE discs.id::text = (storage.foldername(name))[2]
    AND discs.owner_id = auth.uid()
  )
);

-- Policy: Users can read their own disc photos
CREATE POLICY "Users can read own disc photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'disc-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can update their own disc photos
CREATE POLICY "Users can update own disc photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'disc-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'disc-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can delete their own disc photos
CREATE POLICY "Users can delete own disc photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'disc-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- TODO: Add policy for finders to read photos of discs in active recovery events
-- This will be implemented when recovery events feature is added

-- Note: Cannot add comments to storage.objects policies (system table, permission denied)
-- Policy descriptions are in the SQL comments above each policy
