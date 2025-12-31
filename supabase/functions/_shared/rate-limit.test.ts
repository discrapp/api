import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import {
  RateLimiter,
  createRateLimiter,
  checkRateLimit,
  getRateLimitHeaders,
  RateLimitConfig,
  RateLimitResult,
} from './rate-limit.ts';

// Test configuration
const testConfig: RateLimitConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 5,
};

Deno.test('RateLimiter: should create instance with default config', () => {
  const limiter = new RateLimiter();
  assertExists(limiter);
});

Deno.test('RateLimiter: should create instance with custom config', () => {
  const limiter = new RateLimiter(testConfig);
  assertExists(limiter);
});

Deno.test('RateLimiter: should allow requests under limit', () => {
  const limiter = new RateLimiter(testConfig);
  const key = 'test-ip-1';

  for (let i = 0; i < 5; i++) {
    const result = limiter.check(key);
    assertEquals(result.allowed, true, `Request ${i + 1} should be allowed`);
    assertEquals(result.remaining, 4 - i);
  }
});

Deno.test('RateLimiter: should block requests over limit', () => {
  const limiter = new RateLimiter(testConfig);
  const key = 'test-ip-2';

  // Make 5 allowed requests
  for (let i = 0; i < 5; i++) {
    limiter.check(key);
  }

  // 6th request should be blocked
  const result = limiter.check(key);
  assertEquals(result.allowed, false);
  assertEquals(result.remaining, 0);
  assertExists(result.resetTime);
});

Deno.test('RateLimiter: should track separate keys independently', () => {
  const limiter = new RateLimiter(testConfig);

  // Use up all requests for key1
  for (let i = 0; i < 5; i++) {
    limiter.check('key1');
  }

  // key2 should still have full quota
  const result = limiter.check('key2');
  assertEquals(result.allowed, true);
  assertEquals(result.remaining, 4);
});

Deno.test('RateLimiter: should return correct limit in result', () => {
  const limiter = new RateLimiter(testConfig);
  const result = limiter.check('test-key');
  assertEquals(result.limit, 5);
});

Deno.test('RateLimiter: should reset after window expires', async () => {
  const shortWindowConfig: RateLimitConfig = {
    windowMs: 100, // 100ms window for testing
    maxRequests: 2,
  };
  const limiter = new RateLimiter(shortWindowConfig);
  const key = 'test-ip-3';

  // Use up all requests
  limiter.check(key);
  limiter.check(key);

  // Should be blocked
  let result = limiter.check(key);
  assertEquals(result.allowed, false);

  // Wait for window to expire
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Should be allowed again
  result = limiter.check(key);
  assertEquals(result.allowed, true);
  assertEquals(result.remaining, 1);
});

Deno.test('createRateLimiter: should return singleton for same name', () => {
  const limiter1 = createRateLimiter('test-limiter', testConfig);
  const limiter2 = createRateLimiter('test-limiter', testConfig);
  assertEquals(limiter1, limiter2);
});

Deno.test('createRateLimiter: should return different instances for different names', () => {
  const limiter1 = createRateLimiter('limiter-a', testConfig);
  const limiter2 = createRateLimiter('limiter-b', testConfig);
  assertEquals(limiter1 !== limiter2, true);
});

Deno.test('checkRateLimit: should extract IP from x-forwarded-for header', () => {
  const limiter = new RateLimiter(testConfig);
  const req = new Request('https://example.com', {
    headers: {
      'x-forwarded-for': '192.168.1.100, 10.0.0.1',
    },
  });

  const result = checkRateLimit(req, limiter);
  assertEquals(result.allowed, true);
  // Check that subsequent requests to same IP are tracked
  const result2 = checkRateLimit(req, limiter);
  assertEquals(result2.remaining, 3);
});

Deno.test('checkRateLimit: should extract IP from x-real-ip header', () => {
  const limiter = new RateLimiter(testConfig);
  const req = new Request('https://example.com', {
    headers: {
      'x-real-ip': '192.168.1.200',
    },
  });

  const result = checkRateLimit(req, limiter);
  assertEquals(result.allowed, true);
});

Deno.test('checkRateLimit: should use custom key extractor', () => {
  const limiter = new RateLimiter(testConfig);
  const req = new Request('https://example.com', {
    headers: {
      Authorization: 'Bearer user-token-123',
    },
  });

  const keyExtractor = (r: Request) => {
    const auth = r.headers.get('Authorization');
    return auth ? `user:${auth}` : null;
  };

  const result = checkRateLimit(req, limiter, keyExtractor);
  assertEquals(result.allowed, true);

  // Same user should have decreased remaining
  const result2 = checkRateLimit(req, limiter, keyExtractor);
  assertEquals(result2.remaining, 3);
});

Deno.test('checkRateLimit: should fallback to unknown when no key found', () => {
  const limiter = new RateLimiter(testConfig);
  const req = new Request('https://example.com');

  const result = checkRateLimit(req, limiter);
  assertEquals(result.allowed, true);
});

Deno.test('getRateLimitHeaders: should return correct headers when allowed', () => {
  const result: RateLimitResult = {
    allowed: true,
    limit: 100,
    remaining: 95,
    resetTime: Date.now() + 60000,
  };

  const headers = getRateLimitHeaders(result);
  assertEquals(headers['X-RateLimit-Limit'], '100');
  assertEquals(headers['X-RateLimit-Remaining'], '95');
  assertExists(headers['X-RateLimit-Reset']);
});

Deno.test('getRateLimitHeaders: should include Retry-After when blocked', () => {
  const resetTime = Date.now() + 30000;
  const result: RateLimitResult = {
    allowed: false,
    limit: 100,
    remaining: 0,
    resetTime,
  };

  const headers = getRateLimitHeaders(result);
  assertEquals(headers['X-RateLimit-Remaining'], '0');
  assertExists(headers['Retry-After']);
});

Deno.test('RateLimiter: should cleanup old entries', async () => {
  const shortWindowConfig: RateLimitConfig = {
    windowMs: 50,
    maxRequests: 10,
  };
  const limiter = new RateLimiter(shortWindowConfig);

  // Create some entries
  limiter.check('old-key-1');
  limiter.check('old-key-2');

  // Wait for window to expire
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Make a new request to trigger cleanup
  limiter.check('new-key');

  // Old entries should be cleaned up (internal state check via new request)
  const result = limiter.check('old-key-1');
  assertEquals(result.allowed, true);
  assertEquals(result.remaining, 9); // Should have full quota again
});

Deno.test('RateLimiter: should handle concurrent requests to same key', () => {
  const limiter = new RateLimiter(testConfig);
  const key = 'concurrent-key';

  // Simulate concurrent requests
  const results: RateLimitResult[] = [];
  for (let i = 0; i < 10; i++) {
    results.push(limiter.check(key));
  }

  // First 5 should be allowed, next 5 should be blocked
  const allowed = results.filter((r) => r.allowed).length;
  const blocked = results.filter((r) => !r.allowed).length;

  assertEquals(allowed, 5);
  assertEquals(blocked, 5);
});

Deno.test('RateLimiter: should handle edge case of maxRequests = 1', () => {
  const strictConfig: RateLimitConfig = {
    windowMs: 60000,
    maxRequests: 1,
  };
  const limiter = new RateLimiter(strictConfig);
  const key = 'strict-key';

  const result1 = limiter.check(key);
  assertEquals(result1.allowed, true);
  assertEquals(result1.remaining, 0);

  const result2 = limiter.check(key);
  assertEquals(result2.allowed, false);
});
