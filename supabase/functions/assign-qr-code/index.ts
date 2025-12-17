import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Assign QR Code Function
 *
 * Allows a user to claim an unassigned QR code.
 *
 * POST /assign-qr-code
 * Body: { qr_code: string }
 *
 * Returns:
 * - QR code details with updated status
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
  let body: { qr_code?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate qr_code is provided
  if (!body.qr_code) {
    return new Response(JSON.stringify({ error: 'Missing qr_code in request body' }), {
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

  // Check QR code status
  if (qrCode.status === 'assigned') {
    return new Response(JSON.stringify({ error: 'QR code is already assigned' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (qrCode.status === 'active') {
    return new Response(JSON.stringify({ error: 'QR code is already in use' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (qrCode.status === 'deactivated') {
    return new Response(JSON.stringify({ error: 'QR code has been deactivated' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // QR code must be in 'generated' status to be assigned
  if (qrCode.status !== 'generated') {
    return new Response(JSON.stringify({ error: 'QR code cannot be assigned' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update QR code to assigned status
  const { data: updatedQr, error: updateError } = await supabaseAdmin
    .from('qr_codes')
    .update({
      status: 'assigned',
      assigned_to: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', qrCode.id)
    .select()
    .single();

  if (updateError || !updatedQr) {
    console.error('Failed to update QR code:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to assign QR code' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      qr_code: {
        id: updatedQr.id,
        short_code: updatedQr.short_code,
        status: updatedQr.status,
        assigned_to: updatedQr.assigned_to,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
});
