import { assertExists } from 'jsr:@std/assert';

// Store original env
const originalSentryDsn = Deno.env.get('SENTRY_DSN');

Deno.test('sentry module exports required functions', async () => {
  // Clear DSN to prevent actual initialization
  Deno.env.delete('SENTRY_DSN');

  const sentry = await import('./sentry.ts');

  assertExists(sentry.initSentry, 'initSentry should be exported');
  assertExists(sentry.captureException, 'captureException should be exported');
  assertExists(sentry.setUser, 'setUser should be exported');

  // Restore env
  if (originalSentryDsn) {
    Deno.env.set('SENTRY_DSN', originalSentryDsn);
  }
});

Deno.test('initSentry should not throw when DSN is not set', async () => {
  // Clear DSN
  Deno.env.delete('SENTRY_DSN');

  // Re-import to get fresh module
  const sentry = await import('./sentry.ts');

  // Should not throw
  sentry.initSentry();

  // Restore env
  if (originalSentryDsn) {
    Deno.env.set('SENTRY_DSN', originalSentryDsn);
  }
});

Deno.test('captureException should not throw when Sentry is not initialized', async () => {
  // Clear DSN
  Deno.env.delete('SENTRY_DSN');

  const sentry = await import('./sentry.ts');

  // Should not throw, just log
  const testError = new Error('Test error');
  sentry.captureException(testError);
  sentry.captureException(testError, { context: 'test' });

  // Restore env
  if (originalSentryDsn) {
    Deno.env.set('SENTRY_DSN', originalSentryDsn);
  }
});

Deno.test('setUser should not throw when Sentry is not initialized', async () => {
  // Clear DSN
  Deno.env.delete('SENTRY_DSN');

  const sentry = await import('./sentry.ts');

  // Should not throw
  sentry.setUser('user-123');
  sentry.setUser(null);

  // Restore env
  if (originalSentryDsn) {
    Deno.env.set('SENTRY_DSN', originalSentryDsn);
  }
});
