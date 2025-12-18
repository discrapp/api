import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Save Default Shipping Address Function
 *
 * Creates or updates the user's default shipping address.
 *
 * POST /save-default-address
 * Body: {
 *   address_id?: string,  // If provided, updates existing address
 *   name: string,
 *   street_address: string,
 *   street_address_2?: string,
 *   city: string,
 *   state: string,
 *   postal_code: string,
 *   country?: string  // Defaults to 'US'
 * }
 *
 * Returns:
 * - The saved address object
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

  const { address_id, name, street_address, street_address_2, city, state, postal_code, country } = body;

  // Validate required fields
  const requiredFields = ['name', 'street_address', 'city', 'state', 'postal_code'];
  for (const field of requiredFields) {
    if (!body[field]) {
      return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

  // If address_id is provided, verify ownership and update
  if (address_id) {
    // First verify the address belongs to the user
    const { data: existingAddress, error: lookupError } = await supabaseAdmin
      .from('shipping_addresses')
      .select('id, user_id')
      .eq('id', address_id)
      .single();

    if (lookupError || !existingAddress) {
      return new Response(JSON.stringify({ error: 'Address not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (existingAddress.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Address does not belong to user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update the existing address
    const { data: updatedAddress, error: updateError } = await supabaseAdmin
      .from('shipping_addresses')
      .update({
        name,
        street_address,
        street_address_2: street_address_2 || null,
        city,
        state,
        postal_code,
        country: country || 'US',
        is_default: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', address_id)
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
      .single();

    if (updateError) {
      console.error('Failed to update address:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update address' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(updatedAddress), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create new address
  const { data: newAddress, error: insertError } = await supabaseAdmin
    .from('shipping_addresses')
    .insert({
      user_id: user.id,
      name,
      street_address,
      street_address_2: street_address_2 || null,
      city,
      state,
      postal_code,
      country: country || 'US',
      is_default: true,
    })
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
    .single();

  if (insertError) {
    console.error('Failed to create address:', insertError);
    return new Response(JSON.stringify({ error: 'Failed to create address' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(newAddress), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
