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
  botToken?: string;
  channelId?: string;
}

/**
 * Result of posting a Slack message via Web API.
 */
export interface SlackPostResult {
  success: boolean;
  ts?: string;
}

/**
 * Post a message to Slack using the Web API (required to get message ts for updates).
 *
 * @param message - The message to post
 * @param options - Configuration including bot token and channel
 * @returns Object with success status and message ts if successful
 */
export async function postSlackMessage(
  message: SlackMessage,
  options?: NotifyPlasticOptions
): Promise<SlackPostResult> {
  const botToken = options?.botToken ?? Deno.env.get('SLACK_BOT_TOKEN');
  const channelId = options?.channelId ?? Deno.env.get('SLACK_CHANNEL_ID');
  const fetchFn = options?.fetchFn ?? fetch;
  const captureException = options?.captureExceptionFn ?? sentryCaptureException;

  if (!botToken) {
    const error = new Error('SLACK_BOT_TOKEN not configured');
    captureException(error, {
      operation: 'slack-post-message',
      reason: 'missing_bot_token',
    });
    return { success: false };
  }

  if (!channelId) {
    const error = new Error('SLACK_CHANNEL_ID not configured');
    captureException(error, {
      operation: 'slack-post-message',
      reason: 'missing_channel_id',
    });
    return { success: false };
  }

  try {
    const response = await fetchFn('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text: message.text,
        blocks: message.blocks,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      const error = new Error(`Slack postMessage failed: ${data.error}`);
      captureException(error, {
        operation: 'slack-post-message',
        reason: 'api_error',
        slackError: data.error,
      });
      return { success: false };
    }

    return { success: true, ts: data.ts };
  } catch (error) {
    captureException(error, {
      operation: 'slack-post-message',
      reason: 'network_error',
    });
    return { success: false };
  }
}

/**
 * Update an existing Slack message.
 *
 * @param ts - The message timestamp (ID) to update
 * @param message - The new message content
 * @param options - Configuration including bot token and channel
 * @returns true if updated successfully
 */
export async function updateSlackMessage(
  ts: string,
  message: SlackMessage,
  options?: NotifyPlasticOptions
): Promise<boolean> {
  const botToken = options?.botToken ?? Deno.env.get('SLACK_BOT_TOKEN');
  const channelId = options?.channelId ?? Deno.env.get('SLACK_CHANNEL_ID');
  const fetchFn = options?.fetchFn ?? fetch;
  const captureException = options?.captureExceptionFn ?? sentryCaptureException;

  if (!botToken || !channelId) {
    captureException(new Error('Slack credentials not configured for update'), {
      operation: 'slack-update-message',
      reason: 'missing_credentials',
    });
    return false;
  }

  try {
    const response = await fetchFn('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        ts,
        text: message.text,
        blocks: message.blocks,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      const error = new Error(`Slack update failed: ${data.error}`);
      captureException(error, {
        operation: 'slack-update-message',
        reason: 'api_error',
        slackError: data.error,
      });
      return false;
    }

    return true;
  } catch (error) {
    captureException(error, {
      operation: 'slack-update-message',
      reason: 'network_error',
    });
    return false;
  }
}

/**
 * Send a notification about a new pending plastic type submission.
 * Uses Web API to get message ts for later updates.
 *
 * @returns Object with success status and message ts
 */
export async function notifyPendingPlasticType(
  manufacturer: string,
  plasticName: string,
  submitterEmail?: string,
  options?: NotifyPlasticOptions
): Promise<SlackPostResult> {
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

  return postSlackMessage(message, options);
}

/**
 * Update a plastic type notification to show it was approved.
 */
export async function notifyPlasticTypeApproved(
  ts: string,
  manufacturer: string,
  plasticName: string,
  approvedBy?: string,
  options?: NotifyPlasticOptions
): Promise<boolean> {
  const message: SlackMessage = {
    text: `✅ Plastic type approved: ${manufacturer} - ${plasticName}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '✅ Plastic Type Approved',
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
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: approvedBy ? `Approved by: ${approvedBy}` : 'Approved',
          },
        ],
      },
    ],
  };

  return updateSlackMessage(ts, message, options);
}

/**
 * Update a plastic type notification to show it was rejected.
 */
export async function notifyPlasticTypeRejected(
  ts: string,
  manufacturer: string,
  plasticName: string,
  rejectedBy?: string,
  options?: NotifyPlasticOptions
): Promise<boolean> {
  const message: SlackMessage = {
    text: `❌ Plastic type rejected: ${manufacturer} - ${plasticName}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '❌ Plastic Type Rejected',
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
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: rejectedBy ? `Rejected by: ${rejectedBy}` : 'Rejected',
          },
        ],
      },
    ],
  };

  return updateSlackMessage(ts, message, options);
}
