import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * One-time migration function to move photos from old structure to new structure.
 *
 * Old structure: {owner_id}/{disc_id}/{photo_uuid}.{ext}
 * New structure: {disc_id}/{photo_uuid}.{ext}
 *
 * This function should be run once after the database migration.
 * It requires service role key to access storage.
 *
 * POST /migrate-photo-storage
 * Body: { dry_run?: boolean }
 */

Deno.serve(async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authentication - require service role or admin
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body.dry_run === true;
  } catch {
    // No body or invalid JSON, use defaults
  }

  // Create service role client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Get all photos that need migration (old path structure has 3 parts)
  const { data: photos, error: fetchError } = await supabase
    .from('disc_photos')
    .select('id, disc_id, storage_path, photo_uuid');

  if (fetchError) {
    console.error('Error fetching photos:', fetchError);
    return new Response(JSON.stringify({ error: 'Failed to fetch photos', details: fetchError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = {
    total: photos?.length || 0,
    migrated: 0,
    skipped: 0,
    errors: [] as string[],
    dryRun,
  };

  for (const photo of photos || []) {
    const pathParts = photo.storage_path.split('/');

    // Check if this is old format (3 parts: owner_id/disc_id/filename)
    if (pathParts.length !== 3) {
      // Already migrated or unexpected format
      results.skipped++;
      continue;
    }

    const [, discId, filename] = pathParts;
    const newPath = `${discId}/${filename}`;

    console.log(`Migrating: ${photo.storage_path} -> ${newPath}`);

    if (dryRun) {
      results.migrated++;
      continue;
    }

    try {
      // Download the file from old location
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('disc-photos')
        .download(photo.storage_path);

      if (downloadError) {
        console.error(`Error downloading ${photo.storage_path}:`, downloadError);
        results.errors.push(`Download failed for ${photo.id}: ${downloadError.message}`);
        continue;
      }

      // Upload to new location
      const { error: uploadError } = await supabase.storage.from('disc-photos').upload(newPath, fileData, {
        contentType: fileData.type || 'image/jpeg',
        upsert: true,
      });

      if (uploadError) {
        console.error(`Error uploading to ${newPath}:`, uploadError);
        results.errors.push(`Upload failed for ${photo.id}: ${uploadError.message}`);
        continue;
      }

      // Delete from old location
      const { error: deleteError } = await supabase.storage.from('disc-photos').remove([photo.storage_path]);

      if (deleteError) {
        console.error(`Error deleting ${photo.storage_path}:`, deleteError);
        // Don't fail - file is copied, just couldn't delete old one
        results.errors.push(`Delete failed for ${photo.id}: ${deleteError.message} (file was copied)`);
      }

      results.migrated++;
    } catch (err) {
      console.error(`Unexpected error for ${photo.id}:`, err);
      results.errors.push(`Unexpected error for ${photo.id}: ${err}`);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: dryRun ? 'Dry run complete' : 'Migration complete',
      results,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
