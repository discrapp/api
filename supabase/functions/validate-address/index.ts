import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Validate Address Function
 *
 * Validates a US shipping address using the USPS Address Validation API.
 * Returns standardized address or validation errors.
 *
 * POST /validate-address
 * Body: { street_address, street_address_2?, city, state, postal_code }
 *
 * Returns:
 * - { valid: true, standardized: Address } for valid addresses
 * - { valid: false, errors: string[] } for invalid addresses
 */

interface AddressInput {
  street_address: string;
  street_address_2?: string;
  city: string;
  state: string;
  postal_code: string;
}

interface StandardizedAddress {
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
}

Deno.serve(async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check authorization header
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

  // Parse request body
  let body: AddressInput;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  const requiredFields: (keyof AddressInput)[] = ['street_address', 'city', 'state', 'postal_code'];
  for (const field of requiredFields) {
    if (!body[field]) {
      return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Get USPS User ID from environment
  const uspsUserId = Deno.env.get('USPS_USER_ID');
  if (!uspsUserId) {
    console.error('USPS_USER_ID environment variable not set');
    return new Response(JSON.stringify({ error: 'Address validation service not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build USPS API request XML
  // Note: USPS swaps Address1 and Address2 - Address2 is the street address, Address1 is apt/suite
  const uspsXml = `
    <AddressValidateRequest USERID="${uspsUserId}">
      <Address>
        <Address1>${escapeXml(body.street_address_2 || '')}</Address1>
        <Address2>${escapeXml(body.street_address)}</Address2>
        <City>${escapeXml(body.city)}</City>
        <State>${escapeXml(body.state)}</State>
        <Zip5>${escapeXml(body.postal_code.substring(0, 5))}</Zip5>
        <Zip4></Zip4>
      </Address>
    </AddressValidateRequest>
  `.trim();

  const uspsUrl = `https://secure.shippingapis.com/ShippingAPI.dll?API=Verify&XML=${encodeURIComponent(uspsXml)}`;

  try {
    const uspsResponse = await fetch(uspsUrl);
    const responseText = await uspsResponse.text();

    // Check for USPS error response
    const errorMatch = responseText.match(/<Description>([^<]+)<\/Description>/);
    if (errorMatch) {
      return new Response(
        JSON.stringify({
          valid: false,
          errors: [errorMatch[1]],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract standardized address from response
    const address2Match = responseText.match(/<Address2>([^<]+)<\/Address2>/);
    const cityMatch = responseText.match(/<City>([^<]+)<\/City>/);
    const stateMatch = responseText.match(/<State>([^<]+)<\/State>/);
    const zip5Match = responseText.match(/<Zip5>([^<]+)<\/Zip5>/);
    const zip4Match = responseText.match(/<Zip4>([^<]*)<\/Zip4>/);

    if (!address2Match || !cityMatch || !stateMatch || !zip5Match) {
      console.error('Failed to parse USPS response:', responseText);
      return new Response(
        JSON.stringify({
          valid: false,
          errors: ['Unable to validate address'],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Build postal code with ZIP+4 if available
    const postalCode = zip4Match && zip4Match[1] ? `${zip5Match[1]}-${zip4Match[1]}` : zip5Match[1];

    const standardized: StandardizedAddress = {
      street_address: address2Match[1],
      city: cityMatch[1],
      state: stateMatch[1],
      postal_code: postalCode,
    };

    return new Response(
      JSON.stringify({
        valid: true,
        standardized,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('USPS API error:', error);
    return new Response(JSON.stringify({ error: 'Address validation service unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Escape XML special characters to prevent injection
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
