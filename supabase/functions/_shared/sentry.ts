/**
 * Sentry error tracking utilities for Supabase Edge Functions
 *
 * This module provides application logic for error tracking with Sentry.
 * Third-party integration code is separated into sentry-integration.ts.
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

import {
  initSentrySDK,
  isSentryConfigured,
  sendToSentry,
  setSentryUser,
} from './sentry-integration.ts';

// Allow dependency injection for testing
export interface SentryIntegration {
  initSentrySDK: () => Promise<void>;
  isSentryConfigured: () => boolean;
  sendToSentry: (error: Error | unknown, context?: Record<string, unknown>) => void;
  setSentryUser: (userId: string | null) => void;
}

// Default integration (production)
let integration: SentryIntegration = {
  initSentrySDK,
  isSentryConfigured,
  sendToSentry,
  setSentryUser,
};

/**
 * Set a custom integration (for testing)
 * @internal
 */
export function _setIntegration(customIntegration: SentryIntegration): void {
  integration = customIntegration;
}

/**
 * Reset to default integration (for testing)
 * @internal
 */
export function _resetIntegration(): void {
  integration = { initSentrySDK, isSentryConfigured, sendToSentry, setSentryUser };
}

/**
 * Initialize Sentry error tracking.
 * Only initializes if SENTRY_DSN is set.
 * Safe to call multiple times - will only initialize once.
 */
export async function initSentry(): Promise<void> {
  const sentryDsn = Deno.env.get('SENTRY_DSN');
  if (!sentryDsn) {
    console.log('Sentry DSN not configured, skipping initialization');
    return;
  }

  await integration.initSentrySDK();
}

/**
 * Capture an exception and send to Sentry.
 * @param error - The error to capture
 * @param context - Optional context to attach to the error
 */
export function captureException(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!integration.isSentryConfigured()) {
    console.error('Sentry not configured, error logged locally:', error);
    return;
  }

  integration.sendToSentry(error, context);
}

/**
 * Set the current user context for error tracking.
 * @param userId - The user's ID, or null to clear
 */
export function setUser(userId: string | null): void {
  if (!integration.isSentryConfigured()) {
    return;
  }

  integration.setSentryUser(userId);
}

// Re-export for backward compatibility
export { isSentryConfigured as Sentry };
