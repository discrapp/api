import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Link QR Code to Disc Function
 *
 * Links an assigned QR code to an existing disc owned by the user.
 *
 * POST /link-qr-to-disc
 * Body: { qr_code: string, disc_id: string }
 *
 * Returns:
 * - Disc and QR code details with updated status
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

  // Create Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseKey, {
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

  // Parse request body
  let body: { qr_code?: string; disc_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.qr_code) {
    return new Response(JSON.stringify({ error: 'Missing qr_code in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.disc_id) {
    return new Response(JSON.stringify({ error: 'Missing disc_id in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create service role client for database operations
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Look up QR code (case insensitive)
  const { data: qrCode, error: qrError } = await supabaseAdmin
    .from('qr_codes')
    .select('*')
    .ilike('short_code', body.qr_code)
    .single();

  if (qrError || !qrCode) {
    return new Response(JSON.stringify({ error: 'QR code not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check QR code is assigned to current user
  if (qrCode.assigned_to !== user.id) {
    return new Response(JSON.stringify({ error: 'QR code is not assigned to you' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check QR code is in 'assigned' status
  if (qrCode.status !== 'assigned') {
    return new Response(JSON.stringify({ error: 'QR code must be assigned before linking to a disc' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Look up disc
  const { data: disc, error: discError } = await supabaseAdmin
    .from('discs')
    .select('*')
    .eq('id', body.disc_id)
    .single();

  if (discError || !disc) {
    return new Response(JSON.stringify({ error: 'Disc not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check disc is owned by current user
  if (disc.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'You do not own this disc' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check disc doesn't already have a QR code
  if (disc.qr_code_id) {
    return new Response(JSON.stringify({ error: 'Disc already has a QR code linked' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update disc with QR code reference
  const { data: updatedDisc, error: updateDiscError } = await supabaseAdmin
    .from('discs')
    .update({
      qr_code_id: qrCode.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', disc.id)
    .select()
    .single();

  if (updateDiscError || !updatedDisc) {
    console.error('Failed to update disc:', updateDiscError);
    return new Response(JSON.stringify({ error: 'Failed to link QR code to disc' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update QR code status to 'active'
  const { data: updatedQr, error: updateQrError } = await supabaseAdmin
    .from('qr_codes')
    .update({
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', qrCode.id)
    .select()
    .single();

  if (updateQrError || !updatedQr) {
    console.error('Failed to update QR code:', updateQrError);
    // Rollback disc update
    await supabaseAdmin.from('discs').update({ qr_code_id: null }).eq('id', disc.id);
    return new Response(JSON.stringify({ error: 'Failed to activate QR code' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      disc: {
        id: updatedDisc.id,
        name: updatedDisc.name,
        qr_code_id: updatedDisc.qr_code_id,
      },
      qr_code: {
        id: updatedQr.id,
        short_code: updatedQr.short_code,
        status: updatedQr.status,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
