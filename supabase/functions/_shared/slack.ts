/**
 * Slack notification utilities for sending messages to Slack channels.
 *
 * Requires SLACK_WEBHOOK_URL environment variable to be set.
 * If not set, notifications will be silently skipped.
 */

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
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
 * Send a notification to Slack.
 *
 * @param message - Plain text message or structured message with blocks
 * @returns true if sent successfully, false if skipped or failed
 */
export async function sendSlackNotification(message: string | SlackMessage): Promise<boolean> {
  const webhookUrl = Deno.env.get('SLACK_WEBHOOK_URL');

  // Skip if webhook URL is not configured
  if (!webhookUrl) {
    console.log('Slack notification skipped: SLACK_WEBHOOK_URL not configured');
    return false;
  }

  try {
    const payload = typeof message === 'string' ? { text: message } : message;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('Slack notification failed:', response.status, response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Slack notification error:', error);
    return false;
  }
}

/**
 * Send a notification about a new pending plastic type submission.
 */
export async function notifyPendingPlasticType(
  manufacturer: string,
  plasticName: string,
  submitterEmail?: string
): Promise<boolean> {
  const adminUrl = Deno.env.get('ADMIN_URL') || 'https://admin.discrapp.com';

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

  return sendSlackNotification(message);
}
