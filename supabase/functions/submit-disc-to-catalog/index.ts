import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Submit Disc to Catalog Function
 *
 * Authenticated endpoint for users to submit new discs to the catalog.
 * Submitted discs are marked as 'user_submitted' for admin review.
 *
 * POST /submit-disc-to-catalog
 * Authorization: Bearer <token> (required)
 *
 * Body:
 * - manufacturer: string (required)
 * - mold: string (required)
 * - category?: string ('Distance Driver', 'Control Driver', 'Hybrid Driver', 'Midrange', 'Putter', 'Approach Discs')
 * - speed?: number
 * - glide?: number
 * - turn?: number
 * - fade?: number
 * - stability?: string ('Very Overstable', 'Overstable', 'Stable', 'Understable', 'Very Understable')
 *
 * Returns:
 * - 201: Disc submitted successfully
 * - 400: Missing required fields
 * - 401: Not authenticated
 * - 409: Disc already exists in catalog
 *
 * TODO: Add Slack notification for admin review
 */

Deno.serve(async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { manufacturer, mold, category, speed, glide, turn, fade, stability } = body;

  // Validate required fields
  if (!manufacturer) {
    return new Response(JSON.stringify({ error: 'Missing required field: manufacturer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!mold) {
    return new Response(JSON.stringify({ error: 'Missing required field: mold' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create Supabase client with user's auth
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // Verify user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use service role for database operations
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Check if disc already exists
  const { data: existingDisc } = await supabaseAdmin
    .from('disc_catalog')
    .select('id')
    .eq('manufacturer', manufacturer)
    .eq('mold', mold)
    .single();

  if (existingDisc) {
    return new Response(
      JSON.stringify({
        error: 'Disc already exists in catalog',
        disc_id: existingDisc.id,
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Insert new disc with user_submitted status
  const { data: newDisc, error: insertError } = await supabaseAdmin
    .from('disc_catalog')
    .insert({
      manufacturer: manufacturer.trim(),
      mold: mold.trim(),
      category: category?.trim() || null,
      speed: typeof speed === 'number' ? speed : null,
      glide: typeof glide === 'number' ? glide : null,
      turn: typeof turn === 'number' ? turn : null,
      fade: typeof fade === 'number' ? fade : null,
      stability: stability?.trim() || null,
      status: 'user_submitted',
      submitted_by: user.id,
      source: 'user',
    })
    .select()
    .single();

  if (insertError) {
    console.error('Failed to insert disc:', insertError);
    return new Response(JSON.stringify({ error: 'Failed to submit disc', details: insertError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // TODO: Send Slack notification for admin review
  // This would integrate with a Slack webhook to alert admins
  // about new user-submitted discs that need verification

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Disc submitted for review',
      disc: newDisc,
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
