import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Mock data types
interface MockUser {
  id: string;
  email: string;
}

interface MockFile {
  name: string;
  type: string;
  size: number;
  content: string;
}

// Mock state
let mockUsers: MockUser[] = [];
let mockFormData: Map<string, MockFile | string> = new Map();
let mockClaudeResponse: { status: number; body: unknown } = {
  status: 200,
  body: {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          phone_numbers: [{ raw: '(512) 555-1234', normalized: '+15125551234', confidence: 0.95 }],
          disc_info: { manufacturer: 'Innova', mold: 'Destroyer', color: 'Red', plastic: 'Star' },
          other_text: 'PDGA 12345',
        }),
      },
    ],
  },
};

function resetMocks() {
  mockUsers = [];
  mockFormData = new Map();
  mockClaudeResponse = {
    status: 200,
    body: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            phone_numbers: [{ raw: '(512) 555-1234', normalized: '+15125551234', confidence: 0.95 }],
            disc_info: { manufacturer: 'Innova', mold: 'Destroyer', color: 'Red', plastic: 'Star' },
            other_text: 'PDGA 12345',
          }),
        },
      ],
    },
  };
}

// Mock Supabase client
function mockSupabaseClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: mockUsers[0] || null },
        error: mockUsers[0] ? null : { message: 'No user' },
      }),
    },
  };
}

// Mock fetch for Claude API
const originalFetch = globalThis.fetch;
function mockFetch(_url: string | URL | Request, _init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(mockClaudeResponse.body), {
      status: mockClaudeResponse.status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

Deno.test('extract-phone-from-photo: returns 405 for non-POST requests', async () => {
  const response = await mockHandler('GET', null, null);

  assertEquals(response.status, 405);
  const body = await response.json();
  assertEquals(body.error, 'Method not allowed');
});

Deno.test('extract-phone-from-photo: returns 401 without auth header', async () => {
  resetMocks();
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  const response = await mockHandler('POST', null, mockFormData);

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Missing authorization header');
});

Deno.test('extract-phone-from-photo: returns 401 for invalid user', async () => {
  resetMocks();
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  // No user in mockUsers = invalid auth

  const response = await mockHandler('POST', 'Bearer invalid-token', mockFormData);

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error, 'Unauthorized');
});

Deno.test('extract-phone-from-photo: returns 400 when back_image is missing', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  // Only front image, no back image
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'back_image is required');
});

Deno.test('extract-phone-from-photo: returns 400 when front_image is missing', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  // Only back image, no front image
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'front_image is required');
});

Deno.test('extract-phone-from-photo: returns 400 for invalid image type', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockFormData.set('back_image', { name: 'back.gif', type: 'image/gif', size: 1000, content: 'fake' }); // Invalid
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'back_image must be an image (jpeg, png, or webp)');
});

Deno.test('extract-phone-from-photo: returns 400 for oversized image', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024, content: 'fake' }); // 10MB
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error, 'back_image size must be less than 5MB');
});

Deno.test('extract-phone-from-photo: successfully extracts phone number', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  globalThis.fetch = mockFetch;
  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);
  globalThis.fetch = originalFetch;

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertExists(body.phone_numbers);
  assertEquals(body.phone_numbers.length, 1);
  assertEquals(body.phone_numbers[0].normalized, '+15125551234');
  assertExists(body.disc_info);
  assertEquals(body.disc_info.manufacturer, 'Innova');
  assertEquals(body.disc_info.mold, 'Destroyer');
  assertExists(body.processing_time_ms);
});

Deno.test('extract-phone-from-photo: handles no phone number found', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  mockClaudeResponse = {
    status: 200,
    body: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            phone_numbers: [],
            disc_info: { manufacturer: 'Discraft', mold: 'Buzzz', color: 'Blue', plastic: 'Z' },
            other_text: '',
          }),
        },
      ],
    },
  };

  globalThis.fetch = mockFetch;
  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);
  globalThis.fetch = originalFetch;

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.phone_numbers.length, 0);
  assertEquals(body.disc_info.manufacturer, 'Discraft');
});

Deno.test('extract-phone-from-photo: handles Claude API error', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  mockClaudeResponse = {
    status: 500,
    body: { error: 'Internal server error' },
  };

  globalThis.fetch = mockFetch;
  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);
  globalThis.fetch = originalFetch;

  assertEquals(response.status, 502);
  const body = await response.json();
  assertEquals(body.error, 'Phone extraction failed');
});

Deno.test('extract-phone-from-photo: handles multiple phone numbers', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  mockClaudeResponse = {
    status: 200,
    body: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            phone_numbers: [
              { raw: '512-555-1234', normalized: '+15125551234', confidence: 0.95 },
              { raw: '(512) 555-5678', normalized: '+15125555678', confidence: 0.8 },
            ],
            disc_info: { manufacturer: 'MVP', mold: 'Volt', color: 'Yellow', plastic: 'Neutron' },
            other_text: 'John Smith',
          }),
        },
      ],
    },
  };

  globalThis.fetch = mockFetch;
  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);
  globalThis.fetch = originalFetch;

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.phone_numbers.length, 2);
  assertEquals(body.phone_numbers[0].normalized, '+15125551234');
  assertEquals(body.phone_numbers[1].normalized, '+15125555678');
});

Deno.test('extract-phone-from-photo: handles Claude response with markdown wrapper', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockFormData.set('back_image', { name: 'back.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });
  mockFormData.set('front_image', { name: 'front.jpg', type: 'image/jpeg', size: 1000, content: 'fake' });

  mockClaudeResponse = {
    status: 200,
    body: {
      content: [
        {
          type: 'text',
          text:
            '```json\n' +
            JSON.stringify({
              phone_numbers: [{ raw: '555-1234', normalized: '+15551234', confidence: 0.7 }],
              disc_info: { manufacturer: null, mold: null, color: 'Green', plastic: null },
              other_text: '',
            }) +
            '\n```',
        },
      ],
    },
  };

  globalThis.fetch = mockFetch;
  const response = await mockHandler('POST', 'Bearer valid-token', mockFormData);
  globalThis.fetch = originalFetch;

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.success, true);
  assertEquals(body.phone_numbers.length, 1);
});

// Mock handler that simulates the actual handler behavior
async function mockHandler(
  method: string,
  authHeader: string | null,
  formData: Map<string, MockFile | string> | null
): Promise<Response> {
  // Method check
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth check
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // User check
  const client = mockSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate back_image
  const backImage = formData?.get('back_image') as MockFile | undefined;
  if (!backImage) {
    return new Response(JSON.stringify({ error: 'back_image is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(backImage.type)) {
    return new Response(
      JSON.stringify({ error: 'back_image must be an image (jpeg, png, or webp)' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const maxSize = 5 * 1024 * 1024;
  if (backImage.size > maxSize) {
    return new Response(JSON.stringify({ error: 'back_image size must be less than 5MB' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate front_image
  const frontImage = formData?.get('front_image') as MockFile | undefined;
  if (!frontImage) {
    return new Response(JSON.stringify({ error: 'front_image is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!allowedTypes.includes(frontImage.type)) {
    return new Response(
      JSON.stringify({ error: 'front_image must be an image (jpeg, png, or webp)' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (frontImage.size > maxSize) {
    return new Response(JSON.stringify({ error: 'front_image size must be less than 5MB' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Call Claude API (mocked)
  const startTime = Date.now();
  const claudeResponse = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (!claudeResponse.ok) {
    return new Response(
      JSON.stringify({
        error: 'Phone extraction failed',
        details: `Claude API returned ${claudeResponse.status}`,
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const claudeData = await claudeResponse.json();
  const processingTime = Date.now() - startTime;

  const textContent = claudeData.content?.find((c: { type: string }) => c.type === 'text');
  if (!textContent?.text) {
    return new Response(JSON.stringify({ error: 'AI returned no extraction result' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse response - handle markdown wrapping
  let jsonText = textContent.text.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  const parsed = JSON.parse(jsonText);

  return new Response(
    JSON.stringify({
      success: true,
      phone_numbers: parsed.phone_numbers || [],
      disc_info: parsed.disc_info || {},
      other_text: parsed.other_text || '',
      processing_time_ms: processingTime,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
