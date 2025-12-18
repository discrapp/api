import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Get Default Shipping Address Function
 *
 * Returns the user's default shipping address if one exists.
 *
 * GET /get-default-address
 *
 * Returns:
 * - Default address object if exists
 * - null if no default address
 */

Deno.serve(async (req) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
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

  // Get user's default address
  const { data: address, error: addressError } = await supabaseAdmin
    .from('shipping_addresses')
    .select(
      `
      id,
      name,
      street_address,
      street_address_2,
      city,
      state,
      postal_code,
      country,
      is_default,
      created_at,
      updated_at
    `
    )
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single();

  // If no default address found, return null (not an error)
  if (addressError) {
    if (addressError.code === 'PGRST116') {
      // No rows found - user has no default address
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('Failed to fetch address:', addressError);
    return new Response(JSON.stringify({ error: 'Failed to fetch address' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(address), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
