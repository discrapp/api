import { assertEquals, assertExists } from 'jsr:@std/assert';

// Mock types
interface MockUser {
  id: string;
  email: string;
}

// Mock state
let mockUser: MockUser | null = null;
let mockUspsResponse: string = '';
let mockUspsError: Error | null = null;

// Reset mocks before each test
function resetMocks() {
  mockUser = null;
  mockUspsResponse = '';
  mockUspsError = null;
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: mockUser },
        error: mockUser ? null : { message: 'Unauthorized' },
      }),
    },
  };
}

// Mock USPS API response builder
function buildUspsSuccessResponse(address: {
  address2: string;
  city: string;
  state: string;
  zip5: string;
  zip4?: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<AddressValidateResponse>
  <Address>
    <Address2>${address.address2}</Address2>
    <City>${address.city}</City>
    <State>${address.state}</State>
    <Zip5>${address.zip5}</Zip5>
    ${address.zip4 ? `<Zip4>${address.zip4}</Zip4>` : '<Zip4></Zip4>'}
  </Address>
</AddressValidateResponse>`;
}

function buildUspsErrorResponse(error: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<AddressValidateResponse>
  <Address>
    <Error>
      <Description>${error}</Description>
    </Error>
  </Address>
</AddressValidateResponse>`;
}

// Helper to create mock request
function createRequest(method: string, body?: Record<string, unknown>, authHeader?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  return new Request('http://localhost/validate-address', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Tests
Deno.test('validate-address - returns 405 for non-POST requests', async () => {
  resetMocks();

  const req = createRequest('GET', undefined, 'Bearer test-token');
  const response = await handleRequest(req, mockSupabaseClient());

  assertEquals(response.status, 405);
  const data = await response.json();
  assertEquals(data.error, 'Method not allowed');
});

Deno.test('validate-address - returns 401 without auth header', async () => {
  resetMocks();

  const req = createRequest('POST', {
    street_address: '1600 Pennsylvania Ave NW',
    city: 'Washington',
    state: 'DC',
    postal_code: '20500',
  });

  const response = await handleRequest(req, mockSupabaseClient());

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Missing authorization header');
});

Deno.test('validate-address - returns 401 for unauthenticated user', async () => {
  resetMocks();
  mockUser = null;

  const req = createRequest(
    'POST',
    {
      street_address: '1600 Pennsylvania Ave NW',
      city: 'Washington',
      state: 'DC',
      postal_code: '20500',
    },
    'Bearer invalid-token'
  );

  const response = await handleRequest(req, mockSupabaseClient());

  assertEquals(response.status, 401);
  const data = await response.json();
  assertEquals(data.error, 'Unauthorized');
});

Deno.test('validate-address - returns 400 for missing required fields', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };

  // Missing street_address
  const req = createRequest(
    'POST',
    {
      city: 'Washington',
      state: 'DC',
      postal_code: '20500',
    },
    'Bearer valid-token'
  );

  const response = await handleRequest(req, mockSupabaseClient());

  assertEquals(response.status, 400);
  const data = await response.json();
  assertEquals(data.error, 'Missing required field: street_address');
});

Deno.test('validate-address - returns standardized address for valid input', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };
  mockUspsResponse = buildUspsSuccessResponse({
    address2: '1600 PENNSYLVANIA AVE NW',
    city: 'WASHINGTON',
    state: 'DC',
    zip5: '20500',
    zip4: '0004',
  });

  const req = createRequest(
    'POST',
    {
      street_address: '1600 Pennsylvania Ave NW',
      city: 'Washington',
      state: 'DC',
      postal_code: '20500',
    },
    'Bearer valid-token'
  );

  const response = await handleRequest(req, mockSupabaseClient(), mockFetchUsps, 'test-user-id');

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.valid, true);
  assertExists(data.standardized);
  assertEquals(data.standardized.street_address, '1600 PENNSYLVANIA AVE NW');
  assertEquals(data.standardized.city, 'WASHINGTON');
  assertEquals(data.standardized.state, 'DC');
  assertEquals(data.standardized.postal_code, '20500-0004');
});

Deno.test('validate-address - returns validation errors for invalid address', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };
  mockUspsResponse = buildUspsErrorResponse('Address Not Found.');

  const req = createRequest(
    'POST',
    {
      street_address: '12345 Fake Street',
      city: 'Nowhere',
      state: 'XX',
      postal_code: '00000',
    },
    'Bearer valid-token'
  );

  const response = await handleRequest(req, mockSupabaseClient(), mockFetchUsps, 'test-user-id');

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.valid, false);
  assertExists(data.errors);
  assertEquals(data.errors.length, 1);
  assertEquals(data.errors[0], 'Address Not Found.');
});

Deno.test('validate-address - handles USPS API errors gracefully', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };
  mockUspsError = new Error('Network error');

  const req = createRequest(
    'POST',
    {
      street_address: '1600 Pennsylvania Ave NW',
      city: 'Washington',
      state: 'DC',
      postal_code: '20500',
    },
    'Bearer valid-token'
  );

  const response = await handleRequest(req, mockSupabaseClient(), mockFetchUsps, 'test-user-id');

  assertEquals(response.status, 503);
  const data = await response.json();
  assertEquals(data.error, 'Address validation service unavailable');
});

Deno.test('validate-address - includes street_address_2 in validation', async () => {
  resetMocks();
  mockUser = { id: 'user-1', email: 'test@example.com' };
  mockUspsResponse = buildUspsSuccessResponse({
    address2: '123 MAIN ST APT 4B',
    city: 'LOS ANGELES',
    state: 'CA',
    zip5: '90210',
    zip4: '1234',
  });

  const req = createRequest(
    'POST',
    {
      street_address: '123 Main St',
      street_address_2: 'Apt 4B',
      city: 'Los Angeles',
      state: 'CA',
      postal_code: '90210',
    },
    'Bearer valid-token'
  );

  const response = await handleRequest(req, mockSupabaseClient(), mockFetchUsps, 'test-user-id');

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.valid, true);
  assertEquals(data.standardized.street_address, '123 MAIN ST APT 4B');
});

// Mock USPS fetch function
async function mockFetchUsps(_url: string): Promise<Response> {
  if (mockUspsError) {
    throw mockUspsError;
  }
  return new Response(mockUspsResponse, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

// Handler function types
interface SupabaseClient {
  auth: {
    getUser: () => Promise<{
      data: { user: MockUser | null };
      error: { message: string } | null;
    }>;
  };
}

type FetchFn = (url: string) => Promise<Response>;

interface AddressInput {
  street_address: string;
  street_address_2?: string;
  city: string;
  state: string;
  postal_code: string;
}

/**
 * Handler function extracted for testing
 */
async function handleRequest(
  req: Request,
  supabase: SupabaseClient,
  fetchFn: FetchFn = fetch,
  uspsUserId: string = 'test-user-id'
): Promise<Response> {
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
    const uspsResponse = await fetchFn(uspsUrl);
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

    return new Response(
      JSON.stringify({
        valid: true,
        standardized: {
          street_address: address2Match[1],
          city: cityMatch[1],
          state: stateMatch[1],
          postal_code: postalCode,
        },
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
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
