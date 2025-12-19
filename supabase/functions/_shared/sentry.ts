/**
 * Sentry error tracking utilities for Supabase Edge Functions
 *
 * Usage:
 *   import { initSentry, captureException, setUser } from '../_shared/sentry.ts';
 *
 *   // Initialize at the start of the handler
 *   initSentry();
 *
 *   // Set user context after authentication
 *   setUser(userId);
 *
 *   // Capture errors
 *   try {
 *     // ... code
 *   } catch (error) {
 *     captureException(error, { operation: 'create-disc' });
 *   }
 */

// Note: We use dynamic import to avoid loading Sentry when DSN is not set
let Sentry: typeof import('npm:@sentry/node') | null = null;
let initialized = false;

const SENTRY_DSN = Deno.env.get('SENTRY_DSN');

/**
 * Initialize Sentry error tracking.
 * Only initializes if SENTRY_DSN is set.
 * Safe to call multiple times - will only initialize once.
 */
export async function initSentry(): Promise<void> {
  if (initialized || !SENTRY_DSN) {
    if (!SENTRY_DSN) {
      console.log('Sentry DSN not configured, skipping initialization');
    }
    return;
  }

  try {
    Sentry = await import('npm:@sentry/node');
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: Deno.env.get('ENVIRONMENT') || 'production',
      tracesSampleRate: 0.1, // 10% of transactions for performance
    });
    initialized = true;
    console.log('Sentry initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Sentry:', error);
  }
}

/**
 * Capture an exception and send to Sentry.
 * @param error - The error to capture
 * @param context - Optional context to attach to the error
 */
export function captureException(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!Sentry || !SENTRY_DSN) {
    console.error('Sentry not configured, error logged locally:', error);
    return;
  }

  if (context) {
    Sentry.withScope((scope: { setExtras: (extras: Record<string, unknown>) => void }) => {
      scope.setExtras(context);
      Sentry!.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Set the current user context for error tracking.
 * @param userId - The user's ID, or null to clear
 */
export function setUser(userId: string | null): void {
  if (!Sentry || !SENTRY_DSN) {
    return;
  }

  if (userId) {
    Sentry.setUser({ id: userId });
  } else {
    Sentry.setUser(null);
  }
}

// Re-export for direct access if needed
export { Sentry };
