import { assertEquals } from 'jsr:@std/assert';
import { sendSlackNotification, notifyPendingPlasticType, type SlackMessage } from './slack.ts';

// Mock fetch state
let mockFetchCalled = false;
let mockFetchPayload: unknown = null;
let mockFetchResponse = { ok: true };

function mockFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  mockFetchCalled = true;
  mockFetchPayload = init?.body ? JSON.parse(init.body as string) : null;
  return Promise.resolve({
    ok: mockFetchResponse.ok,
    status: mockFetchResponse.ok ? 200 : 500,
    statusText: mockFetchResponse.ok ? 'OK' : 'Internal Server Error',
  } as Response);
}

function resetMocks() {
  mockFetchCalled = false;
  mockFetchPayload = null;
  mockFetchResponse = { ok: true };
}

Deno.test('sendSlackNotification: skips when webhook URL not configured', async () => {
  resetMocks();

  // Call without webhookUrl option (and no env var)
  // Don't provide fetchFn to exercise the ?? fetch fallback path
  const result = await sendSlackNotification('Test message', {
    webhookUrl: undefined,
  });

  assertEquals(result, false);
  assertEquals(mockFetchCalled, false);
});

Deno.test('sendSlackNotification: sends simple text message', async () => {
  resetMocks();

  const result = await sendSlackNotification('Test message', {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: mockFetch,
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockFetchPayload, { text: 'Test message' });
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
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockFetchPayload, message);
});

Deno.test('sendSlackNotification: returns false on fetch failure', async () => {
  resetMocks();
  mockFetchResponse = { ok: false };

  const result = await sendSlackNotification('Test message', {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: mockFetch,
  });

  assertEquals(result, false);
  assertEquals(mockFetchCalled, true);
});

Deno.test('sendSlackNotification: returns false on fetch exception', async () => {
  resetMocks();

  const throwingFetch = (): Promise<Response> => {
    throw new Error('Network error');
  };

  const result = await sendSlackNotification('Test message', {
    webhookUrl: 'https://hooks.slack.com/test',
    fetchFn: throwingFetch,
  });

  assertEquals(result, false);
});

Deno.test('notifyPendingPlasticType: sends formatted notification', async () => {
  resetMocks();

  const result = await notifyPendingPlasticType('Innova', 'Halo Star', 'test@example.com', {
    webhookUrl: 'https://hooks.slack.com/test',
    adminUrl: 'https://admin.discrapp.com',
    fetchFn: mockFetch,
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);

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
  });

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);

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
  });

  const payload = mockFetchPayload as SlackMessage;
  const linkBlock = payload.blocks!.find(
    (b) => b.type === 'section' && b.text?.text?.includes('Review in Admin Dashboard')
  );
  assertEquals(linkBlock?.text?.text?.includes('custom-admin.example.com'), true);
});

Deno.test('notifyPendingPlasticType: returns false when webhook not configured', async () => {
  resetMocks();

  const result = await notifyPendingPlasticType('Innova', 'Star', undefined, {
    webhookUrl: undefined,
    fetchFn: mockFetch,
  });

  assertEquals(result, false);
  assertEquals(mockFetchCalled, false);
});
