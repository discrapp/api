/**
 * Rate Limiting Request Wrapper
 *
 * Provides a wrapper function to apply rate limiting to edge function handlers.
 * Can be composed with other wrappers like withSentry.
 *
 * Usage:
 *   import { withRateLimit } from '../_shared/with-rate-limit.ts';
 *   import { withSentry } from '../_shared/with-sentry.ts';
 *
 *   const handler = async (req: Request): Promise<Response> => {
 *     // ... your handler code
 *   };
 *
 *   // Apply both rate limiting and Sentry error tracking
 *   Deno.serve(withSentry(withRateLimit(handler, { windowMs: 60000, maxRequests: 10 })));
 *
 *   // Or with user-based rate limiting
 *   const userKeyExtractor = (req: Request) => {
 *     const auth = req.headers.get('Authorization');
 *     return auth ? `user:${auth}` : null;
 *   };
 *   Deno.serve(withSentry(withRateLimit(handler, { windowMs: 60000, maxRequests: 100 }, userKeyExtractor)));
 */

import { RateLimiter, RateLimitConfig, checkRateLimit, getRateLimitHeaders, KeyExtractor } from './rate-limit.ts';

/** Default configuration for rate limiting */
const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 100, // 100 requests per minute
};

/**
 * Wrap a request handler with rate limiting
 *
 * @param handler - The request handler to wrap
 * @param config - Rate limit configuration
 * @param keyExtractor - Optional custom function to extract the rate limit key
 * @returns Wrapped handler that applies rate limiting
 */
export function withRateLimit(
  handler: (req: Request) => Promise<Response>,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
  keyExtractor?: KeyExtractor
): (req: Request) => Promise<Response> {
  const limiter = new RateLimiter(config);

  return async (req: Request): Promise<Response> => {
    // Check rate limit
    const result = checkRateLimit(req, limiter, keyExtractor);
    const rateLimitHeaders = getRateLimitHeaders(result);

    if (!result.allowed) {
      // Return 429 Too Many Requests
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: rateLimitHeaders['Retry-After'],
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...rateLimitHeaders,
          },
        }
      );
    }

    // Call the actual handler
    const response = await handler(req);

    // Add rate limit headers to the response
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(rateLimitHeaders)) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}

/**
 * Predefined rate limit configurations for different use cases
 */
export const RateLimitPresets = {
  /** Strict limit for authentication endpoints (10 per minute) */
  auth: {
    windowMs: 60000,
    maxRequests: 10,
  } as RateLimitConfig,

  /** Stricter limit for payment/sensitive endpoints (5 per minute) */
  payment: {
    windowMs: 60000,
    maxRequests: 5,
  } as RateLimitConfig,

  /** Standard limit for general API endpoints (100 per minute) */
  standard: {
    windowMs: 60000,
    maxRequests: 100,
  } as RateLimitConfig,

  /** Relaxed limit for read-heavy endpoints (200 per minute) */
  relaxed: {
    windowMs: 60000,
    maxRequests: 200,
  } as RateLimitConfig,

  /** Very strict limit for expensive operations (2 per minute) */
  expensive: {
    windowMs: 60000,
    maxRequests: 2,
  } as RateLimitConfig,
} as const;
