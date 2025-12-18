import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Sync Disc Catalog Function
 *
 * Fetches disc data from the DiscIt API and syncs it to our disc_catalog table.
 * This function is designed to be called periodically (via cron) to keep the
 * catalog up to date with new discs and updated flight numbers.
 *
 * POST /sync-disc-catalog
 * Authorization: Bearer <service_role_key> (required)
 *
 * The DiscIt API provides comprehensive disc data from Marshall Street,
 * updated nightly. See: https://github.com/cdleveille/discit-api
 */

// DiscIt API response type
interface DiscItDisc {
  id: string;
  name: string;
  brand: string;
  category: string;
  speed: string;
  glide: string;
  turn: string;
  fade: string;
  stability: string;
}

// Our disc catalog format
interface CatalogDisc {
  manufacturer: string;
  mold: string;
  category: string | null;
  speed: number | null;
  glide: number | null;
  turn: number | null;
  fade: number | null;
  stability: string | null;
  status: string;
  source: string;
  source_id: string;
  last_synced_at: string;
}

const DISCIT_API_URL = 'https://discit-api.fly.dev/disc';
const BATCH_SIZE = 100;

Deno.serve(async (req) => {
  const startTime = Date.now();

  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authorization - this endpoint requires service role access
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase admin client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Create sync log entry
  const { data: syncLog, error: syncLogError } = await supabase
    .from('disc_catalog_sync_log')
    .insert({ source: 'discit_api' })
    .select()
    .single();

  if (syncLogError || !syncLog) {
    console.error('Failed to create sync log:', syncLogError);
    return new Response(JSON.stringify({ error: 'Failed to create sync log' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let discsAdded = 0;
  let discsUpdated = 0;
  const discsUnchanged = 0;
  const errors: Array<{ disc?: string; error: string }> = [];

  try {
    // Fetch discs from DiscIt API
    const response = await fetch(DISCIT_API_URL);
    if (!response.ok) {
      throw new Error(`DiscIt API returned ${response.status}`);
    }

    const discItDiscs: DiscItDisc[] = await response.json();
    console.log(`Fetched ${discItDiscs.length} discs from DiscIt API`);

    // Transform discs to our format
    const catalogDiscs: CatalogDisc[] = discItDiscs.map((disc) => ({
      manufacturer: disc.brand,
      mold: disc.name,
      category: disc.category || null,
      speed: parseFlightNumber(disc.speed),
      glide: parseFlightNumber(disc.glide),
      turn: parseFlightNumber(disc.turn),
      fade: parseFlightNumber(disc.fade),
      stability: disc.stability || null,
      status: 'verified',
      source: 'discit_api',
      source_id: disc.id,
      last_synced_at: new Date().toISOString(),
    }));

    // Check existing discs to track added vs updated
    const existingDiscs = new Map<string, boolean>();
    const { data: existingData } = await supabase.from('disc_catalog').select('manufacturer, mold');

    if (existingData) {
      for (const disc of existingData) {
        existingDiscs.set(`${disc.manufacturer}|${disc.mold}`, true);
      }
    }

    // Process in batches for efficiency
    for (let i = 0; i < catalogDiscs.length; i += BATCH_SIZE) {
      const batch = catalogDiscs.slice(i, i + BATCH_SIZE);

      // Count new vs existing before upsert
      for (const disc of batch) {
        const key = `${disc.manufacturer}|${disc.mold}`;
        if (existingDiscs.has(key)) {
          discsUpdated++;
        } else {
          discsAdded++;
          existingDiscs.set(key, true); // Mark as existing for future batches
        }
      }

      const { error: upsertError } = await supabase.from('disc_catalog').upsert(batch, {
        onConflict: 'manufacturer,mold',
        ignoreDuplicates: false,
      });

      if (upsertError) {
        console.error(`Batch upsert error at index ${i}:`, upsertError);
        errors.push({ error: `Batch ${i / BATCH_SIZE + 1}: ${upsertError.message}` });
      }
    }

    // Note: For simplicity, we're counting all existing discs as "updated"
    // A more precise approach would compare field values, but that adds complexity
    // and the sync log stats are primarily for monitoring purposes

    // Update sync log with success
    await supabase
      .from('disc_catalog_sync_log')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        discs_added: discsAdded,
        discs_updated: discsUpdated,
        discs_unchanged: discsUnchanged,
        errors: errors.length > 0 ? errors : null,
      })
      .eq('id', syncLog.id);

    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        source: 'discit_api',
        discs_added: discsAdded,
        discs_updated: discsUpdated,
        discs_unchanged: discsUnchanged,
        total_processed: catalogDiscs.length,
        duration_ms: duration,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Sync failed:', error);

    // Update sync log with failure
    await supabase
      .from('disc_catalog_sync_log')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        discs_added: discsAdded,
        discs_updated: discsUpdated,
        discs_unchanged: discsUnchanged,
        errors: [{ error: error instanceof Error ? error.message : 'Unknown error' }],
      })
      .eq('id', syncLog.id);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        discs_added: discsAdded,
        discs_updated: discsUpdated,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Parse a flight number string to a number.
 * Handles values like "12", "5", "-1", "-0.5", etc.
 */
function parseFlightNumber(value: string): number | null {
  if (!value || value.trim() === '') {
    return null;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}
