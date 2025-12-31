import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import { withRateLimit, RateLimitPresets } from './with-rate-limit.ts';
import { RateLimitConfig } from './rate-limit.ts';

// Test handler that returns a simple response
const testHandler = async (_req: Request): Promise<Response> => {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// Test configuration with low limit for easy testing
const testConfig: RateLimitConfig = {
  windowMs: 60000,
  maxRequests: 3,
};

Deno.test('withRateLimit: should allow requests under limit', async () => {
  const wrappedHandler = withRateLimit(testHandler, testConfig);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.1' },
  });

  const response = await wrappedHandler(req);
  assertEquals(response.status, 200);

  const data = await response.json();
  assertEquals(data.success, true);
});

Deno.test('withRateLimit: should include rate limit headers in response', async () => {
  const wrappedHandler = withRateLimit(testHandler, testConfig);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.2' },
  });

  const response = await wrappedHandler(req);

  assertExists(response.headers.get('X-RateLimit-Limit'));
  assertExists(response.headers.get('X-RateLimit-Remaining'));
  assertExists(response.headers.get('X-RateLimit-Reset'));

  assertEquals(response.headers.get('X-RateLimit-Limit'), '3');
});

Deno.test('withRateLimit: should return 429 when rate limit exceeded', async () => {
  const wrappedHandler = withRateLimit(testHandler, testConfig);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.3' },
  });

  // Make requests up to the limit
  for (let i = 0; i < 3; i++) {
    await wrappedHandler(req);
  }

  // Next request should be blocked
  const response = await wrappedHandler(req);
  assertEquals(response.status, 429);

  const data = await response.json();
  assertEquals(data.error, 'Too many requests');
  assertExists(data.retryAfter);
});

Deno.test('withRateLimit: should include Retry-After header when blocked', async () => {
  const wrappedHandler = withRateLimit(testHandler, testConfig);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.4' },
  });

  // Exhaust the limit
  for (let i = 0; i < 3; i++) {
    await wrappedHandler(req);
  }

  const response = await wrappedHandler(req);
  assertExists(response.headers.get('Retry-After'));
});

Deno.test('withRateLimit: should use custom key extractor', async () => {
  const userKeyExtractor = (r: Request) => {
    const userId = r.headers.get('X-User-Id');
    return userId ? `user:${userId}` : null;
  };

  const wrappedHandler = withRateLimit(testHandler, testConfig, userKeyExtractor);

  // Request from user1
  const req1 = new Request('https://example.com', {
    headers: { 'X-User-Id': 'user1' },
  });

  // Request from user2
  const req2 = new Request('https://example.com', {
    headers: { 'X-User-Id': 'user2' },
  });

  // Both users should have their own quota
  const response1 = await wrappedHandler(req1);
  const response2 = await wrappedHandler(req2);

  assertEquals(response1.status, 200);
  assertEquals(response2.status, 200);

  // Check remaining counts are independent
  assertEquals(response1.headers.get('X-RateLimit-Remaining'), '2');
  assertEquals(response2.headers.get('X-RateLimit-Remaining'), '2');
});

Deno.test('withRateLimit: should decrement remaining count correctly', async () => {
  const wrappedHandler = withRateLimit(testHandler, testConfig);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.5' },
  });

  const response1 = await wrappedHandler(req);
  assertEquals(response1.headers.get('X-RateLimit-Remaining'), '2');

  const response2 = await wrappedHandler(req);
  assertEquals(response2.headers.get('X-RateLimit-Remaining'), '1');

  const response3 = await wrappedHandler(req);
  assertEquals(response3.headers.get('X-RateLimit-Remaining'), '0');
});

Deno.test('withRateLimit: should preserve original response headers', async () => {
  const handlerWithHeaders = async (_req: Request): Promise<Response> => {
    return new Response(JSON.stringify({ data: 'test' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
      },
    });
  };

  const wrappedHandler = withRateLimit(handlerWithHeaders, testConfig);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.6' },
  });

  const response = await wrappedHandler(req);

  // Original headers should be preserved
  assertEquals(response.headers.get('Content-Type'), 'application/json');
  assertEquals(response.headers.get('X-Custom-Header'), 'custom-value');

  // Rate limit headers should be added
  assertExists(response.headers.get('X-RateLimit-Limit'));
});

Deno.test('withRateLimit: should preserve original response status', async () => {
  const handlerWith201 = async (_req: Request): Promise<Response> => {
    return new Response(JSON.stringify({ created: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const wrappedHandler = withRateLimit(handlerWith201, testConfig);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.7' },
  });

  const response = await wrappedHandler(req);
  assertEquals(response.status, 201);
});

Deno.test('RateLimitPresets: should have correct auth preset', () => {
  assertEquals(RateLimitPresets.auth.windowMs, 60000);
  assertEquals(RateLimitPresets.auth.maxRequests, 10);
});

Deno.test('RateLimitPresets: should have correct payment preset', () => {
  assertEquals(RateLimitPresets.payment.windowMs, 60000);
  assertEquals(RateLimitPresets.payment.maxRequests, 5);
});

Deno.test('RateLimitPresets: should have correct standard preset', () => {
  assertEquals(RateLimitPresets.standard.windowMs, 60000);
  assertEquals(RateLimitPresets.standard.maxRequests, 100);
});

Deno.test('RateLimitPresets: should have correct relaxed preset', () => {
  assertEquals(RateLimitPresets.relaxed.windowMs, 60000);
  assertEquals(RateLimitPresets.relaxed.maxRequests, 200);
});

Deno.test('RateLimitPresets: should have correct expensive preset', () => {
  assertEquals(RateLimitPresets.expensive.windowMs, 60000);
  assertEquals(RateLimitPresets.expensive.maxRequests, 2);
});

Deno.test('withRateLimit: should work with RateLimitPresets', async () => {
  const wrappedHandler = withRateLimit(testHandler, RateLimitPresets.auth);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.8' },
  });

  const response = await wrappedHandler(req);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('X-RateLimit-Limit'), '10');
});

Deno.test('withRateLimit: should use default config when none provided', async () => {
  const wrappedHandler = withRateLimit(testHandler);
  const req = new Request('https://example.com', {
    headers: { 'x-forwarded-for': '192.168.1.9' },
  });

  const response = await wrappedHandler(req);
  assertEquals(response.status, 200);
  // Default is 100 requests
  assertEquals(response.headers.get('X-RateLimit-Limit'), '100');
});
