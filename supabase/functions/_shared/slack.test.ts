import { assertEquals } from 'jsr:@std/assert';
import {
  sendSlackNotification,
  postSlackMessage,
  updateSlackMessage,
  notifyPendingPlasticType,
  notifyPlasticTypeApproved,
  notifyPlasticTypeRejected,
  type SlackMessage,
} from './slack.ts';

// Mock fetch state
let mockFetchCalled = false;
let mockFetchUrl = '';
let mockFetchPayload: unknown = null;
let mockFetchResponse: { ok: boolean; error?: string; ts?: string } = { ok: true, ts: '1234567890.123456' };

// Mock Sentry captureException state
let mockCaptureExceptionCalled = false;
let mockCaptureExceptionError: Error | unknown = null;
let mockCaptureExceptionContext: Record<string, unknown> | undefined = undefined;

function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  mockFetchCalled = true;
  mockFetchUrl = typeof input === 'string' ? input : input.toString();
  mockFetchPayload = init?.body ? JSON.parse(init.body as string) : null;

  // For webhook calls, return simple ok/error
  if (mockFetchUrl.includes('hooks.slack.com')) {
    return Promise.resolve({
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.ok ? 200 : 500,
      statusText: mockFetchResponse.ok ? 'OK' : 'Internal Server Error',
    } as Response);
  }

  // For Web API calls, return JSON with ts
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(mockFetchResponse),
  } as Response);
}

function mockCaptureException(error: Error | unknown, context?: Record<string, unknown>): void {
  mockCaptureExceptionCalled = true;
  mockCaptureExceptionError = error;
  mockCaptureExceptionContext = context;
}

function resetMocks() {
  mockFetchCalled = false;
  mockFetchUrl = '';
  mockFetchPayload = null;
  mockFetchResponse = { ok: true, ts: '1234567890.123456' };
  mockCaptureExceptionCalled = false;
  mockCaptureExceptionError = null;
  mockCaptureExceptionContext = undefined;
}

// ============================================
// sendSlackNotification tests (webhook-based)
// ============================================

Deno.test('sendSlackNotification: reports error to Sentry when webhook URL not configured', async () => {
  resetMocks();

  const result = await sendSlackNotification('Test message', {
    webhookUrl: undefined,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, false);
  assertEquals(mockFetchCalled, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'SLACK_ADMIN_WEBHOOK_URL not configured');
  assertEquals(mockCaptureExceptionContext?.operation, 'slack-notification');
  assertEquals(mockCaptureExceptionContext?.reason, 'missing_webhook_url');
});

Deno.test('sendSlackNotification: sends simple text message', async () => {
  resetMocks();

  const result = await sendSlackNotification('Test message', {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockFetchPayload, { text: 'Test message' });
  assertEquals(mockCaptureExceptionCalled, false);
});

Deno.test('sendSlackNotification: sends structured message with blocks', async () => {
  resetMocks();

  const message: SlackMessage = {
    text: 'Fallback text',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Header' },
      },
    ],
  };

  const result = await sendSlackNotification(message, {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockFetchPayload, message);
  assertEquals(mockCaptureExceptionCalled, false);
});

Deno.test('sendSlackNotification: reports error to Sentry on fetch failure', async () => {
  resetMocks();
  mockFetchResponse = { ok: false };

  const result = await sendSlackNotification('Test message', {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, false);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'Slack notification failed: 500 Internal Server Error');
  assertEquals(mockCaptureExceptionContext?.operation, 'slack-notification');
  assertEquals(mockCaptureExceptionContext?.reason, 'api_error');
  assertEquals(mockCaptureExceptionContext?.status, 500);
});

Deno.test('sendSlackNotification: reports error to Sentry on fetch exception', async () => {
  resetMocks();

  const throwingFetch = (): Promise<Response> => {
    throw new Error('Network error');
  };

  const result = await sendSlackNotification('Test message', {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: throwingFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'Network error');
  assertEquals(mockCaptureExceptionContext?.operation, 'slack-notification');
  assertEquals(mockCaptureExceptionContext?.reason, 'network_error');
});

Deno.test('sendSlackNotification: uses default captureException when not provided', async () => {
  resetMocks();

  const result = await sendSlackNotification('Test message', {
    webhookUrl: undefined,
  });

  assertEquals(result, false);
  assertEquals(mockFetchCalled, false);
});

Deno.test('sendSlackNotification: uses default fetch when not provided', async () => {
  resetMocks();

  const result = await sendSlackNotification('Test message', {
    webhookUrl: undefined,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, false);
});

// ============================================
// postSlackMessage tests (Web API)
// ============================================

Deno.test('postSlackMessage: reports error when bot token not configured', async () => {
  resetMocks();

  const result = await postSlackMessage(
    { text: 'Test' },
    {
      botToken: undefined,
      channelId: 'C123',
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result.success, false);
  assertEquals(result.ts, undefined);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'SLACK_BOT_TOKEN not configured');
});

Deno.test('postSlackMessage: reports error when channel ID not configured', async () => {
  resetMocks();

  const result = await postSlackMessage(
    { text: 'Test' },
    {
      botToken: 'xoxb-test',
      channelId: undefined,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result.success, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'SLACK_CHANNEL_ID not configured');
});

Deno.test('postSlackMessage: posts message and returns ts', async () => {
  resetMocks();
  mockFetchResponse = { ok: true, ts: '1234567890.123456' };

  const result = await postSlackMessage(
    { text: 'Test message', blocks: [] },
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result.success, true);
  assertEquals(result.ts, '1234567890.123456');
  assertEquals(mockFetchCalled, true);
  assertEquals(mockFetchUrl, 'https://slack.com/api/chat.postMessage');
  assertEquals(mockCaptureExceptionCalled, false);
});

Deno.test('postSlackMessage: reports error on API failure', async () => {
  resetMocks();
  mockFetchResponse = { ok: false, error: 'channel_not_found' };

  const result = await postSlackMessage(
    { text: 'Test' },
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result.success, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'Slack postMessage failed: channel_not_found');
});

Deno.test('postSlackMessage: reports error on network failure', async () => {
  resetMocks();

  const throwingFetch = (): Promise<Response> => {
    throw new Error('Network error');
  };

  const result = await postSlackMessage(
    { text: 'Test' },
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: throwingFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result.success, false);
  assertEquals(mockCaptureExceptionCalled, true);
});

Deno.test('postSlackMessage: uses default captureException when not provided', async () => {
  resetMocks();

  // This will fail because bot token is not set, but it exercises the default captureException path
  const result = await postSlackMessage(
    { text: 'Test' },
    {
      botToken: undefined,
      channelId: 'C123',
      fetchFn: mockFetch,
      // captureExceptionFn not provided - uses default
    }
  );

  assertEquals(result.success, false);
  // Default captureException was used (no error thrown)
});

// ============================================
// updateSlackMessage tests
// ============================================

Deno.test('updateSlackMessage: updates message successfully', async () => {
  resetMocks();
  mockFetchResponse = { ok: true };

  const result = await updateSlackMessage(
    '1234567890.123456',
    { text: 'Updated message' },
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, true);
  assertEquals(mockFetchUrl, 'https://slack.com/api/chat.update');
  assertEquals((mockFetchPayload as Record<string, unknown>).ts, '1234567890.123456');
});

Deno.test('updateSlackMessage: reports error when credentials missing', async () => {
  resetMocks();

  const result = await updateSlackMessage(
    '1234567890.123456',
    { text: 'Updated' },
    {
      botToken: undefined,
      channelId: 'C123',
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, false);
  assertEquals(mockCaptureExceptionCalled, true);
});

Deno.test('updateSlackMessage: reports error on API failure', async () => {
  resetMocks();
  mockFetchResponse = { ok: false, error: 'message_not_found' };

  const result = await updateSlackMessage(
    '1234567890.123456',
    { text: 'Updated' },
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'Slack update failed: message_not_found');
});

// ============================================
// notifyPendingPlasticType tests
// ============================================

Deno.test('notifyPendingPlasticType: sends notification and returns ts', async () => {
  resetMocks();
  mockFetchResponse = { ok: true, ts: '1234567890.123456' };

  const result = await notifyPendingPlasticType('Innova', 'Halo Star', 'test@example.com', {
    botToken: 'xoxb-test',
    channelId: 'C123',
    adminUrl: 'https://admin.discrapp.com',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result.success, true);
  assertEquals(result.ts, '1234567890.123456');
  assertEquals(mockFetchCalled, true);

  const payload = mockFetchPayload as { text: string; blocks: unknown[] };
  assertEquals(payload.text, 'New plastic type submitted for review: Innova - Halo Star');
  assertEquals(payload.blocks.length, 4); // header, section, context, link
});

Deno.test('notifyPendingPlasticType: works without submitter email', async () => {
  resetMocks();
  mockFetchResponse = { ok: true, ts: '1234567890.123456' };

  const result = await notifyPendingPlasticType('Discraft', 'ESP FLX', undefined, {
    botToken: 'xoxb-test',
    channelId: 'C123',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result.success, true);
  const payload = mockFetchPayload as { blocks: unknown[] };
  assertEquals(payload.blocks.length, 3); // no context block
});

Deno.test('notifyPendingPlasticType: returns failure when not configured', async () => {
  resetMocks();

  const result = await notifyPendingPlasticType('Innova', 'Star', undefined, {
    botToken: undefined,
    channelId: 'C123',
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result.success, false);
  assertEquals(mockCaptureExceptionCalled, true);
});

// ============================================
// notifyPlasticTypeApproved tests
// ============================================

Deno.test('notifyPlasticTypeApproved: updates message with approval', async () => {
  resetMocks();
  mockFetchResponse = { ok: true };

  const result = await notifyPlasticTypeApproved(
    '1234567890.123456',
    'Innova',
    'Halo Star',
    'admin@example.com',
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, true);
  assertEquals(mockFetchUrl, 'https://slack.com/api/chat.update');

  const payload = mockFetchPayload as { text: string; blocks: Array<{ type: string; text?: { text: string } }> };
  assertEquals(payload.text, '✅ Plastic type approved: Innova - Halo Star');
  assertEquals(payload.blocks[0].text?.text, '✅ Plastic Type Approved');
});

Deno.test('notifyPlasticTypeApproved: works without approver email', async () => {
  resetMocks();
  mockFetchResponse = { ok: true };

  const result = await notifyPlasticTypeApproved(
    '1234567890.123456',
    'Innova',
    'Star',
    undefined,
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, true);
});

// ============================================
// notifyPlasticTypeRejected tests
// ============================================

Deno.test('notifyPlasticTypeRejected: updates message with rejection', async () => {
  resetMocks();
  mockFetchResponse = { ok: true };

  const result = await notifyPlasticTypeRejected(
    '1234567890.123456',
    'Innova',
    'Test Plastic',
    'admin@example.com',
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, true);

  const payload = mockFetchPayload as { text: string; blocks: Array<{ type: string; text?: { text: string } }> };
  assertEquals(payload.text, '❌ Plastic type rejected: Innova - Test Plastic');
  assertEquals(payload.blocks[0].text?.text, '❌ Plastic Type Rejected');
});

Deno.test('notifyPlasticTypeRejected: works without rejectedBy email', async () => {
  resetMocks();
  mockFetchResponse = { ok: true };

  const result = await notifyPlasticTypeRejected(
    '1234567890.123456',
    'Discraft',
    'ESP',
    undefined,
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, true);

  // Check that the context block shows "Rejected" without email
  const payload = mockFetchPayload as { blocks: Array<{ type: string; elements?: Array<{ text: string }> }> };
  const contextBlock = payload.blocks.find((b) => b.type === 'context');
  assertEquals(contextBlock?.elements?.[0]?.text, 'Rejected');
});

Deno.test('updateSlackMessage: reports error on network failure', async () => {
  resetMocks();

  const throwingFetch = (): Promise<Response> => {
    throw new Error('Network error');
  };

  const result = await updateSlackMessage(
    '1234567890.123456',
    { text: 'Updated' },
    {
      botToken: 'xoxb-test',
      channelId: 'C123',
      fetchFn: throwingFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'Network error');
  assertEquals(mockCaptureExceptionContext?.operation, 'slack-update-message');
  assertEquals(mockCaptureExceptionContext?.reason, 'network_error');
});

Deno.test('updateSlackMessage: uses default captureException when not provided', async () => {
  resetMocks();

  // This will fail because credentials are not set, but it exercises the default path
  const result = await updateSlackMessage(
    '1234567890.123456',
    { text: 'Updated' },
    {
      botToken: undefined,
      channelId: 'C123',
      fetchFn: mockFetch,
      // captureExceptionFn not provided - uses default
    }
  );

  assertEquals(result, false);
  // Default captureException was used (no error thrown)
});

Deno.test('updateSlackMessage: falls back to env var when channelId not provided', async () => {
  resetMocks();

  // botToken provided but channelId not provided - exercises the Deno.env.get fallback
  // Since SLACK_CHANNEL_ID is not set in test env, this will fail with missing credentials
  const result = await updateSlackMessage(
    '1234567890.123456',
    { text: 'Updated' },
    {
      botToken: 'xoxb-test',
      // channelId not provided - falls back to Deno.env.get('SLACK_CHANNEL_ID')
      fetchFn: mockFetch,
      captureExceptionFn: mockCaptureException,
    }
  );

  assertEquals(result, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'Slack credentials not configured for update');
});
