-- Create storage bucket for profile photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  false, -- Private bucket (signed URLs required)
  5242880, -- 5MB in bytes
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: Users can upload/update their own profile photo
-- Path structure: {user_id}.{ext} (flat, no folders)
CREATE POLICY "Users can upload own profile photo"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos' AND
  SPLIT_PART(name, '.', 1) = auth.uid()::text
);

-- Policy: Users can update their own profile photo
CREATE POLICY "Users can update own profile photo"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos' AND
  SPLIT_PART(name, '.', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-photos' AND
  SPLIT_PART(name, '.', 1) = auth.uid()::text
);

-- Policy: Users can delete their own profile photo
CREATE POLICY "Users can delete own profile photo"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-photos' AND
  SPLIT_PART(name, '.', 1) = auth.uid()::text
);

-- Policy: Authenticated users can read any profile photo
-- This allows viewing other users' avatars in recovery views
CREATE POLICY "Authenticated users can read profile photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'profile-photos');
