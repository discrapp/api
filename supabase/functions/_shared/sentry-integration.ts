/**
 * Sentry Integration Module
 *
 * This file contains direct integration with the @sentry/node npm package.
 * It is excluded from coverage requirements because:
 * 1. It requires the actual Sentry npm package at test time
 * 2. Cannot be reasonably mocked in Deno's test environment
 * 3. Contains only third-party library calls, no application logic
 *
 * See TESTING.md for full rationale.
 *
 * @module sentry-integration
 * @excluded-from-coverage Third-party integration
 */

// Note: We use dynamic import to avoid loading Sentry when DSN is not set
let Sentry: typeof import('npm:@sentry/node') | null = null;
let initialized = false;

/**
 * Initialize the Sentry SDK.
 * Only called when SENTRY_DSN is configured.
 */
export async function initSentrySDK(): Promise<void> {
  const sentryDsn = Deno.env.get('SENTRY_DSN');
  if (initialized || !sentryDsn) {
    return;
  }

  try {
    Sentry = await import('npm:@sentry/node');
    Sentry.init({
      dsn: sentryDsn,
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
 * Send an exception to Sentry.
 * Only called when Sentry is initialized.
 */
export function sendToSentry(
  error: Error | unknown,
  context?: Record<string, unknown>
): void {
  const sentryDsn = Deno.env.get('SENTRY_DSN');
  if (!Sentry || !sentryDsn) {
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
 * Set user context in Sentry.
 * Only called when Sentry is initialized.
 */
export function setSentryUser(userId: string | null): void {
  const sentryDsn = Deno.env.get('SENTRY_DSN');
  if (!Sentry || !sentryDsn) {
    return;
  }

  if (userId) {
    Sentry.setUser({ id: userId });
  } else {
    Sentry.setUser(null);
  }
}

export function isSentryConfigured(): boolean {
  const sentryDsn = Deno.env.get('SENTRY_DSN');
  return !!(Sentry && sentryDsn);
}
