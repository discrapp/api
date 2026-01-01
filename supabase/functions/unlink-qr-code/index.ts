import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withSentry } from '../_shared/with-sentry.ts';
import { setUser } from '../_shared/sentry.ts';

/**
 * Unlink QR Code from Disc Function
 *
 * Removes a QR code from a disc and deletes it from the database.
 * Only the disc owner can unlink the QR code.
 *
 * POST /unlink-qr-code
 * Body: { disc_id: string }
 *
 * Returns:
 * - Disc details with qr_code_id set to null
 */

const handler = async (req: Request): Promise<Response> => {
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

  // Set Sentry user context
  setUser(user.id);

  // Parse request body
  let body: { disc_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!body.disc_id) {
    return new Response(JSON.stringify({ error: 'Missing disc_id in request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create service role client for database operations
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

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

  // Check disc has a QR code linked
  if (!disc.qr_code_id) {
    return new Response(JSON.stringify({ error: 'Disc has no QR code linked' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const qrCodeId = disc.qr_code_id;

  // Update disc to remove QR code reference
  const { data: updatedDisc, error: updateDiscError } = await supabaseAdmin
    .from('discs')
    .update({
      qr_code_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', disc.id)
    .select()
    .single();

  if (updateDiscError || !updatedDisc) {
    console.error('Failed to update disc:', updateDiscError);
    return new Response(JSON.stringify({ error: 'Failed to unlink QR code from disc' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete the QR code from the database
  const { error: deleteQrError } = await supabaseAdmin.from('qr_codes').delete().eq('id', qrCodeId);

  if (deleteQrError) {
    console.error('Failed to delete QR code:', deleteQrError);
    // Rollback disc update
    await supabaseAdmin.from('discs').update({ qr_code_id: qrCodeId }).eq('id', disc.id);
    return new Response(JSON.stringify({ error: 'Failed to delete QR code' }), {
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
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

Deno.serve(withSentry(handler));
