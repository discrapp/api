import { assertEquals } from 'jsr:@std/assert';
import { sendPushNotification } from './push-notifications.ts';

Deno.test('push-notifications - returns false when user has no push token', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { push_token: null },
            error: null,
          }),
        }),
      }),
    }),
  };

  const result = await sendPushNotification({
    userId: 'user-123',
    title: 'Test',
    body: 'Test message',
    supabaseAdmin: mockSupabase,
  });

  assertEquals(result, false);
});

Deno.test('push-notifications - returns false when profile query errors', async () => {
  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: null,
            error: { message: 'Not found' },
          }),
        }),
      }),
    }),
  };

  const result = await sendPushNotification({
    userId: 'user-123',
    title: 'Test',
    body: 'Test message',
    supabaseAdmin: mockSupabase,
  });

  assertEquals(result, false);
});

Deno.test('push-notifications - sends notification successfully', async () => {
  // Mock fetch globally
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ data: { status: 'ok' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { push_token: 'ExponentPushToken[test123]' },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve(),
      }),
    }),
  };

  const result = await sendPushNotification({
    userId: 'user-123',
    title: 'Test Notification',
    body: 'This is a test',
    data: { foo: 'bar' },
    supabaseAdmin: mockSupabase,
  });

  assertEquals(result, true);

  // Restore fetch
  globalThis.fetch = originalFetch;
});

Deno.test('push-notifications - handles API error response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ error: 'Invalid token' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { push_token: 'ExponentPushToken[test123]' },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve(),
      }),
    }),
  };

  const result = await sendPushNotification({
    userId: 'user-123',
    title: 'Test',
    body: 'Test message',
    supabaseAdmin: mockSupabase,
  });

  assertEquals(result, false);

  globalThis.fetch = originalFetch;
});

Deno.test('push-notifications - clears token on DeviceNotRegistered error', async () => {
  const originalFetch = globalThis.fetch;
  let tokenCleared = false;

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        data: {
          status: 'error',
          details: { error: 'DeviceNotRegistered' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { push_token: 'ExponentPushToken[test123]' },
            error: null,
          }),
        }),
      }),
      update: (_data: Record<string, unknown>) => ({
        eq: (_column: string) => {
          tokenCleared = true;
          return Promise.resolve();
        },
      }),
    }),
  };

  const result = await sendPushNotification({
    userId: 'user-123',
    title: 'Test',
    body: 'Test message',
    supabaseAdmin: mockSupabase,
  });

  assertEquals(result, false);
  assertEquals(tokenCleared, true);

  globalThis.fetch = originalFetch;
});

Deno.test('push-notifications - handles fetch exception', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Network error');
  };

  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { push_token: 'ExponentPushToken[test123]' },
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve(),
      }),
    }),
  };

  const result = await sendPushNotification({
    userId: 'user-123',
    title: 'Test',
    body: 'Test message',
    supabaseAdmin: mockSupabase,
  });

  assertEquals(result, false);

  globalThis.fetch = originalFetch;
});

Deno.test('push-notifications - includes optional data field', async () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let requestBody: any = null;

  globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
    if (options?.body) {
      requestBody = JSON.parse(options.body as string);
    }
    return new Response(
      JSON.stringify({ data: { status: 'ok' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { push_token: 'ExponentPushToken[test123]' },
            error: null,
          }),
        }),
      }),
    }),
  };

  await sendPushNotification({
    userId: 'user-123',
    title: 'Test',
    body: 'Test message',
    data: { custom: 'value', id: 42 },
    supabaseAdmin: mockSupabase,
  });

  assertEquals(requestBody?.data, { custom: 'value', id: 42 });
  assertEquals(requestBody?.sound, 'default');

  globalThis.fetch = originalFetch;
});

Deno.test('push-notifications - works without optional data field', async () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let requestBody: any = null;

  globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
    if (options?.body) {
      requestBody = JSON.parse(options.body as string);
    }
    return new Response(
      JSON.stringify({ data: { status: 'ok' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const mockSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { push_token: 'ExponentPushToken[test123]' },
            error: null,
          }),
        }),
      }),
    }),
  };

  await sendPushNotification({
    userId: 'user-123',
    title: 'Test',
    body: 'Test message',
    supabaseAdmin: mockSupabase,
  });

  assertEquals(requestBody?.data, {});

  globalThis.fetch = originalFetch;
});
