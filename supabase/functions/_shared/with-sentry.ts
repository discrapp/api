/**
 * Request wrapper that initializes Sentry and catches unhandled errors.
 *
 * Usage:
 *   import { withSentry } from '../_shared/with-sentry.ts';
 *
 *   const handler = async (req: Request): Promise<Response> => {
 *     // ... your handler code
 *   };
 *
 *   Deno.serve(withSentry(handler));
 */

import { initSentry, captureException } from './sentry.ts';

export function withSentry(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    // Initialize Sentry (safe to call multiple times)
    await initSentry();

    try {
      return await handler(req);
    } catch (error) {
      // Capture any unhandled errors
      captureException(error as Error, {
        url: req.url,
        method: req.method,
      });

      // Return a generic error response
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
