import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Report Found Disc Function
 *
 * Authenticated endpoint for finders to report they found a disc.
 * Creates a recovery event and notifies the owner.
 *
 * POST /report-found-disc
 * Body: { qr_code: string, message?: string }
 *
 * Validations:
 * - QR code must exist and be assigned to a disc
 * - No active recovery for this disc
 * - Finder cannot report their own disc
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

  const { qr_code, message } = body;

  if (!qr_code) {
    return new Response(JSON.stringify({ error: 'Missing qr_code in request body' }), {
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

  // Use service role for database operations (to bypass RLS for lookups)
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Look up the QR code
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .select('id, short_code, status')
    .eq('short_code', qr_code.toUpperCase())
    .single();

  if (qrError || !qrCode) {
    return new Response(JSON.stringify({ error: 'Invalid QR code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if QR code is assigned
  if (qrCode.status !== 'assigned' && qrCode.status !== 'active') {
    return new Response(JSON.stringify({ error: 'QR code is not assigned to a disc' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get the disc associated with this QR code
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .select('id, owner_id, name')
    .eq('qr_code_id', qrCode.id)
    .single();

  if (discError || !disc) {
    return new Response(JSON.stringify({ error: 'Disc not found for this QR code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if finder is trying to report their own disc
  if (disc.owner_id === user.id) {
    return new Response(JSON.stringify({ error: 'You cannot report your own disc as found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for existing active recovery
  const { data: activeRecovery } = await supabaseAdmin
    .from('recovery_events')
    .select('id, status')
    .eq('disc_id', disc.id)
    .in('status', ['found', 'meetup_proposed', 'meetup_confirmed'])
    .limit(1)
    .maybeSingle();

  if (activeRecovery) {
    return new Response(
      JSON.stringify({
        error: 'This disc already has an active recovery in progress',
        recovery_status: activeRecovery.status,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Create the recovery event
  const { data: recoveryEvent, error: createError } = await supabaseAdmin
    .from('recovery_events')
    .insert({
      disc_id: disc.id,
      finder_id: user.id,
      status: 'found',
      finder_message: message || null,
      found_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (createError) {
    console.error('Failed to create recovery event:', createError);
    return new Response(JSON.stringify({ error: 'Failed to create recovery event', details: createError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Return the created recovery event
  return new Response(
    JSON.stringify({
      success: true,
      recovery_event: {
        id: recoveryEvent.id,
        disc_id: recoveryEvent.disc_id,
        disc_name: disc.name,
        status: recoveryEvent.status,
        finder_message: recoveryEvent.finder_message,
        found_at: recoveryEvent.found_at,
        created_at: recoveryEvent.created_at,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
