import { assertEquals } from 'jsr:@std/assert';
import { sendSlackNotification, notifyPendingPlasticType, type SlackMessage } from './slack.ts';

// Mock fetch state
let mockFetchCalled = false;
let mockFetchPayload: unknown = null;
let mockFetchResponse = { ok: true };

// Mock Sentry captureException state
let mockCaptureExceptionCalled = false;
let mockCaptureExceptionError: Error | unknown = null;
let mockCaptureExceptionContext: Record<string, unknown> | undefined = undefined;

function mockFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  mockFetchCalled = true;
  mockFetchPayload = init?.body ? JSON.parse(init.body as string) : null;
  return Promise.resolve({
    ok: mockFetchResponse.ok,
    status: mockFetchResponse.ok ? 200 : 500,
    statusText: mockFetchResponse.ok ? 'OK' : 'Internal Server Error',
  } as Response);
}

function mockCaptureException(error: Error | unknown, context?: Record<string, unknown>): void {
  mockCaptureExceptionCalled = true;
  mockCaptureExceptionError = error;
  mockCaptureExceptionContext = context;
}

function resetMocks() {
  mockFetchCalled = false;
  mockFetchPayload = null;
  mockFetchResponse = { ok: true };
  mockCaptureExceptionCalled = false;
  mockCaptureExceptionError = null;
  mockCaptureExceptionContext = undefined;
}

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

Deno.test('notifyPendingPlasticType: sends formatted notification', async () => {
  resetMocks();

  const result = await notifyPendingPlasticType('Innova', 'Halo Star', 'test@example.com', {
    webhookUrl: 'https://hooks.slack.com/test',
    adminUrl: 'https://admin.discrapp.com',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockCaptureExceptionCalled, false);

  // Check the payload structure
  const payload = mockFetchPayload as SlackMessage;
  assertEquals(payload.text, 'New plastic type submitted for review: Innova - Halo Star');
  assertEquals(Array.isArray(payload.blocks), true);
  assertEquals(payload.blocks!.length, 4); // header, section with fields, context, section with link
});

Deno.test('notifyPendingPlasticType: works without submitter email', async () => {
  resetMocks();

  const result = await notifyPendingPlasticType('Discraft', 'ESP FLX', undefined, {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockCaptureExceptionCalled, false);

  // Check the payload - should have 3 blocks (no context block)
  const payload = mockFetchPayload as SlackMessage;
  assertEquals(payload.blocks!.length, 3); // header, section with fields, section with link
});

Deno.test('notifyPendingPlasticType: uses custom admin URL', async () => {
  resetMocks();

  await notifyPendingPlasticType('MVP', 'Neutron', undefined, {
    webhookUrl: 'https://hooks.slack.com/test',
    adminUrl: 'https://custom-admin.example.com',
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  const payload = mockFetchPayload as SlackMessage;
  const linkBlock = payload.blocks!.find(
    (b) => b.type === 'section' && b.text?.text?.includes('Review in Admin Dashboard')
  );
  assertEquals(linkBlock?.text?.text?.includes('custom-admin.example.com'), true);
  assertEquals(mockCaptureExceptionCalled, false);
});

Deno.test('notifyPendingPlasticType: reports error to Sentry when webhook not configured', async () => {
  resetMocks();

  const result = await notifyPendingPlasticType('Innova', 'Star', undefined, {
    webhookUrl: undefined,
    fetchFn: mockFetch,
    captureExceptionFn: mockCaptureException,
  });

  assertEquals(result, false);
  assertEquals(mockFetchCalled, false);
  assertEquals(mockCaptureExceptionCalled, true);
  assertEquals((mockCaptureExceptionError as Error).message, 'SLACK_ADMIN_WEBHOOK_URL not configured');
});
