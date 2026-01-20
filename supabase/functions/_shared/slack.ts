/**
 * Slack notification utilities for sending messages to Slack channels.
 *
 * Requires SLACK_ADMIN_WEBHOOK_URL environment variable to be set.
 * If not set, an error is reported to Sentry.
 */

import { captureException as sentryCaptureException } from './sentry.ts';

export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

export interface SlackBlock {
  type: 'section' | 'header' | 'divider' | 'context';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: 'plain_text' | 'mrkdwn';
    text: string;
  }>;
  elements?: Array<{
    type: 'plain_text' | 'mrkdwn';
    text: string;
  }>;
}

/**
 * Options for sending Slack notifications.
 * Used for dependency injection in tests.
 */
export interface SlackOptions {
  webhookUrl?: string;
  fetchFn?: typeof fetch;
  captureExceptionFn?: (error: Error | unknown, context?: Record<string, unknown>) => void;
}

/**
 * Send a notification to Slack.
 *
 * @param message - Plain text message or structured message with blocks
 * @param options - Optional configuration for testing (webhook URL, fetch function)
 * @returns true if sent successfully, false if skipped or failed
 */
export async function sendSlackNotification(message: string | SlackMessage, options?: SlackOptions): Promise<boolean> {
  const webhookUrl = options?.webhookUrl ?? Deno.env.get('SLACK_ADMIN_WEBHOOK_URL');
  const fetchFn = options?.fetchFn ?? fetch;
  const captureException = options?.captureExceptionFn ?? sentryCaptureException;

  // Report error if webhook URL is not configured
  if (!webhookUrl) {
    const error = new Error('SLACK_ADMIN_WEBHOOK_URL not configured');
    captureException(error, {
      operation: 'slack-notification',
      reason: 'missing_webhook_url',
    });
    return false;
  }

  try {
    const payload = typeof message === 'string' ? { text: message } : message;

    const response = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = new Error(`Slack notification failed: ${response.status} ${response.statusText}`);
      captureException(error, {
        operation: 'slack-notification',
        reason: 'api_error',
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    return true;
  } catch (error) {
    captureException(error, {
      operation: 'slack-notification',
      reason: 'network_error',
    });
    return false;
  }
}

/**
 * Options for notifyPendingPlasticType.
 * Used for dependency injection in tests.
 */
export interface NotifyPlasticOptions extends SlackOptions {
  adminUrl?: string;
}

/**
 * Send a notification about a new pending plastic type submission.
 */
export async function notifyPendingPlasticType(
  manufacturer: string,
  plasticName: string,
  submitterEmail?: string,
  options?: NotifyPlasticOptions
): Promise<boolean> {
  const adminUrl = options?.adminUrl ?? Deno.env.get('ADMIN_URL') ?? 'https://admin.discrapp.com';

  const message: SlackMessage = {
    text: `New plastic type submitted for review: ${manufacturer} - ${plasticName}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🧪 New Plastic Type Submission',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Manufacturer:*\n${manufacturer}`,
          },
          {
            type: 'mrkdwn',
            text: `*Plastic Name:*\n${plasticName}`,
          },
        ],
      },
      ...(submitterEmail
        ? [
            {
              type: 'context' as const,
              elements: [
                {
                  type: 'mrkdwn' as const,
                  text: `Submitted by: ${submitterEmail}`,
                },
              ],
            },
          ]
        : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${adminUrl}/plastics?status=pending|Review in Admin Dashboard>`,
        },
      },
    ],
  };

  return sendSlackNotification(message, options);
}
