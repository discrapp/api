import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { withSentry } from '../_shared/with-sentry.ts';

/**
 * Test Sentry Function
 *
 * Simple endpoint to verify Sentry error tracking is working.
 * Throws an error that should be captured by Sentry.
 *
 * GET /test-sentry - Throws a test error
 */

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Throw an unhandled error that Sentry should capture
  throw new Error(`Test Sentry Error from API ${Date.now()}`);
};

Deno.serve(withSentry(handler));
