/**
 * Rate Limiting Utility
 *
 * Provides in-memory rate limiting for Supabase Edge Functions.
 * Uses a sliding window algorithm with IP-based or custom key tracking.
 *
 * Usage:
 *   import { createRateLimiter, checkRateLimit, getRateLimitHeaders } from '../_shared/rate-limit.ts';
 *   import { withRateLimit } from '../_shared/with-rate-limit.ts';
 *
 *   // Option 1: Manual rate limiting
 *   const limiter = createRateLimiter('my-function', { windowMs: 60000, maxRequests: 10 });
 *   const result = checkRateLimit(req, limiter);
 *   if (!result.allowed) {
 *     return new Response(JSON.stringify({ error: 'Too many requests' }), {
 *       status: 429,
 *       headers: { ...getRateLimitHeaders(result), 'Content-Type': 'application/json' },
 *     });
 *   }
 *
 *   // Option 2: Wrapper function (see with-rate-limit.ts)
 *   Deno.serve(withRateLimit(handler, { windowMs: 60000, maxRequests: 10 }));
 */

/**
 * Configuration for rate limiting
 */
export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Maximum requests allowed in the window */
  limit: number;
  /** Remaining requests in the current window */
  remaining: number;
  /** Unix timestamp when the rate limit resets */
  resetTime: number;
}

/**
 * Internal entry for tracking request counts
 */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/** Default rate limit configuration */
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 100, // 100 requests per minute
};

/**
 * In-memory rate limiter using sliding window algorithm
 */
export class RateLimiter {
  private entries: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;
  private lastCleanup: number = Date.now();
  private readonly cleanupInterval: number = 60000; // Cleanup every minute

  constructor(config: RateLimitConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Check if a request from the given key is allowed
   */
  check(key: string): RateLimitResult {
    const now = Date.now();

    // Periodic cleanup of old entries
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup(now);
    }

    let entry = this.entries.get(key);

    // Check if window has expired
    if (!entry || now - entry.windowStart >= this.config.windowMs) {
      // Start a new window
      entry = {
        count: 1,
        windowStart: now,
      };
      this.entries.set(key, entry);

      return {
        allowed: true,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests - 1,
        resetTime: now + this.config.windowMs,
      };
    }

    // Window is still active
    const resetTime = entry.windowStart + this.config.windowMs;

    if (entry.count >= this.config.maxRequests) {
      // Rate limit exceeded
      return {
        allowed: false,
        limit: this.config.maxRequests,
        remaining: 0,
        resetTime,
      };
    }

    // Increment counter and allow
    entry.count++;
    const remaining = this.config.maxRequests - entry.count;

    return {
      allowed: true,
      limit: this.config.maxRequests,
      remaining: Math.max(0, remaining),
      resetTime,
    };
  }

  /**
   * Clean up expired entries to prevent memory leaks
   */
  private cleanup(now: number): void {
    this.lastCleanup = now;
    const expiredBefore = now - this.config.windowMs;

    for (const [key, entry] of this.entries) {
      if (entry.windowStart < expiredBefore) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Force cleanup to run. For testing purposes only.
   * @internal
   */
  _forceCleanup(): void {
    this.lastCleanup = 0; // Reset so next check triggers cleanup
  }

  /**
   * Get entry count for testing. For testing purposes only.
   * @internal
   */
  _getEntryCount(): number {
    return this.entries.size;
  }
}

/**
 * Registry of named rate limiters for singleton access
 */
const limiterRegistry: Map<string, RateLimiter> = new Map();

/**
 * Create or get a named rate limiter instance
 * Returns the same instance if called multiple times with the same name
 */
export function createRateLimiter(name: string, config: RateLimitConfig = DEFAULT_CONFIG): RateLimiter {
  if (!limiterRegistry.has(name)) {
    limiterRegistry.set(name, new RateLimiter(config));
  }
  return limiterRegistry.get(name)!;
}

/**
 * Extract client IP from request headers
 * Checks common headers set by proxies and load balancers
 */
function extractClientIp(req: Request): string | null {
  // X-Forwarded-For: client, proxy1, proxy2
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const ips = forwarded.split(',').map((ip) => ip.trim());
    if (ips.length > 0 && ips[0]) {
      return ips[0];
    }
  }

  // X-Real-IP: client
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // CF-Connecting-IP (Cloudflare)
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }

  return null;
}

/**
 * Type for custom key extractor function
 */
export type KeyExtractor = (req: Request) => string | null;

/**
 * Check rate limit for a request
 * @param req - The incoming request
 * @param limiter - The rate limiter instance
 * @param keyExtractor - Optional custom function to extract the rate limit key
 * @returns Rate limit result
 */
export function checkRateLimit(req: Request, limiter: RateLimiter, keyExtractor?: KeyExtractor): RateLimitResult {
  let key: string | null = null;

  if (keyExtractor) {
    key = keyExtractor(req);
  }

  if (!key) {
    key = extractClientIp(req);
  }

  if (!key) {
    // Fallback to a generic key if no IP found
    // This is less ideal but prevents errors
    key = 'unknown';
  }

  return limiter.check(key);
}

/**
 * Get standard rate limit headers from a result
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(),
  };

  if (!result.allowed) {
    // Calculate seconds until reset
    const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
    headers['Retry-After'] = Math.max(1, retryAfter).toString();
  }

  return headers;
}
