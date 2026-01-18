import { assertEquals } from 'jsr:@std/assert';

// Mock fetch for testing
let mockFetchCalled = false;
let mockFetchPayload: unknown = null;
let mockFetchResponse = { ok: true };

const originalFetch = globalThis.fetch;

function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  mockFetchCalled = true;
  mockFetchPayload = init?.body ? JSON.parse(init.body as string) : null;
  return Promise.resolve({
    ok: mockFetchResponse.ok,
    status: mockFetchResponse.ok ? 200 : 500,
    statusText: mockFetchResponse.ok ? 'OK' : 'Internal Server Error',
  } as Response);
}

// Mock Deno.env
let mockEnvVars: Record<string, string> = {};
const originalEnv = Deno.env;

function setupMockEnv(vars: Record<string, string>) {
  mockEnvVars = vars;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (Deno as unknown as { env: typeof Deno.env }).env = {
    get: (key: string) => mockEnvVars[key],
    set: () => {},
    delete: () => {},
    has: (key: string) => key in mockEnvVars,
    toObject: () => ({ ...mockEnvVars }),
  } as typeof Deno.env;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

function restoreEnv() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (Deno as unknown as { env: typeof Deno.env }).env = originalEnv;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

function resetMocks() {
  mockFetchCalled = false;
  mockFetchPayload = null;
  mockFetchResponse = { ok: true };
  globalThis.fetch = mockFetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// Import after mocking
async function importModule() {
  // Clear the module cache by using a unique URL each time
  const timestamp = Date.now() + Math.random();
  return await import(`./slack.ts?t=${timestamp}`);
}

Deno.test('sendSlackNotification: skips when webhook URL not configured', async () => {
  resetMocks();
  setupMockEnv({});

  const { sendSlackNotification } = await importModule();
  const result = await sendSlackNotification('Test message');

  assertEquals(result, false);
  assertEquals(mockFetchCalled, false);

  restoreEnv();
  restoreFetch();
});

Deno.test('sendSlackNotification: sends simple text message', async () => {
  resetMocks();
  setupMockEnv({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test' });

  const { sendSlackNotification } = await importModule();
  const result = await sendSlackNotification('Test message');

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockFetchPayload, { text: 'Test message' });

  restoreEnv();
  restoreFetch();
});

Deno.test('sendSlackNotification: sends structured message with blocks', async () => {
  resetMocks();
  setupMockEnv({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test' });

  const { sendSlackNotification } = await importModule();
  const message = {
    text: 'Fallback text',
    blocks: [
      {
        type: 'header' as const,
        text: { type: 'plain_text' as const, text: 'Header' },
      },
    ],
  };
  const result = await sendSlackNotification(message);

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);
  assertEquals(mockFetchPayload, message);

  restoreEnv();
  restoreFetch();
});

Deno.test('sendSlackNotification: returns false on fetch failure', async () => {
  resetMocks();
  mockFetchResponse = { ok: false };
  setupMockEnv({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test' });

  const { sendSlackNotification } = await importModule();
  const result = await sendSlackNotification('Test message');

  assertEquals(result, false);
  assertEquals(mockFetchCalled, true);

  restoreEnv();
  restoreFetch();
});

Deno.test('notifyPendingPlasticType: sends formatted notification', async () => {
  resetMocks();
  setupMockEnv({
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
    ADMIN_URL: 'https://admin.discrapp.com',
  });

  const { notifyPendingPlasticType } = await importModule();
  const result = await notifyPendingPlasticType('Innova', 'Halo Star', 'test@example.com');

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);

  // Check the payload structure
  const payload = mockFetchPayload as { text: string; blocks: unknown[] };
  assertEquals(payload.text, 'New plastic type submitted for review: Innova - Halo Star');
  assertEquals(Array.isArray(payload.blocks), true);

  restoreEnv();
  restoreFetch();
});

Deno.test('notifyPendingPlasticType: works without submitter email', async () => {
  resetMocks();
  setupMockEnv({
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
  });

  const { notifyPendingPlasticType } = await importModule();
  const result = await notifyPendingPlasticType('Discraft', 'ESP FLX');

  assertEquals(result, true);
  assertEquals(mockFetchCalled, true);

  restoreEnv();
  restoreFetch();
});
