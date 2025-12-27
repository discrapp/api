import { assertEquals } from 'jsr:@std/assert';
import { withSentry } from './with-sentry.ts';

// Clear Sentry DSN for testing
const originalDsn = Deno.env.get('SENTRY_DSN');
Deno.env.delete('SENTRY_DSN');

Deno.test('with-sentry - wraps handler successfully', async () => {
  const mockHandler = async (req: Request): Promise<Response> => {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const wrappedHandler = withSentry(mockHandler);
  const mockRequest = new Request('https://example.com/test', { method: 'GET' });
  const response = await wrappedHandler(mockRequest);

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { success: true });
});

Deno.test('with-sentry - catches and handles errors', async () => {
  const mockHandler = async (_req: Request): Promise<Response> => {
    throw new Error('Test error');
  };

  const wrappedHandler = withSentry(mockHandler);
  const mockRequest = new Request('https://example.com/test', { method: 'POST' });
  const response = await wrappedHandler(mockRequest);

  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body, { error: 'Internal server error' });
});

Deno.test('with-sentry - preserves request context on error', async () => {
  const mockHandler = async (_req: Request): Promise<Response> => {
    throw new Error('Context test error');
  };

  const wrappedHandler = withSentry(mockHandler);
  const mockRequest = new Request('https://example.com/special-path?param=value', {
    method: 'PUT',
  });
  const response = await wrappedHandler(mockRequest);

  assertEquals(response.status, 500);
  assertEquals(response.headers.get('Content-Type'), 'application/json');
});

Deno.test('with-sentry - handles non-Error exceptions', async () => {
  const mockHandler = async (_req: Request): Promise<Response> => {
    // eslint-disable-next-line no-throw-literal
    throw 'String error';
  };

  const wrappedHandler = withSentry(mockHandler);
  const mockRequest = new Request('https://example.com/test', { method: 'GET' });
  const response = await wrappedHandler(mockRequest);

  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body, { error: 'Internal server error' });
});

Deno.test('with-sentry - multiple calls work independently', async () => {
  const successHandler = async (_req: Request): Promise<Response> => {
    return new Response(JSON.stringify({ result: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const errorHandler = async (_req: Request): Promise<Response> => {
    throw new Error('Failure');
  };

  const wrappedSuccess = withSentry(successHandler);
  const wrappedError = withSentry(errorHandler);

  const mockRequest1 = new Request('https://example.com/success', { method: 'GET' });
  const mockRequest2 = new Request('https://example.com/error', { method: 'GET' });

  const response1 = await wrappedSuccess(mockRequest1);
  const response2 = await wrappedError(mockRequest2);

  assertEquals(response1.status, 200);
  assertEquals(response2.status, 500);
});

Deno.test({
  name: 'with-sentry - handles async errors correctly',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const mockHandler = async (_req: Request): Promise<Response> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('Async error');
    };

    const wrappedHandler = withSentry(mockHandler);
    const mockRequest = new Request('https://example.com/async', { method: 'GET' });
    const response = await wrappedHandler(mockRequest);

    assertEquals(response.status, 500);
  },
});

Deno.test('with-sentry - preserves successful response details', async () => {
  const mockHandler = async (_req: Request): Promise<Response> => {
    return new Response(JSON.stringify({ data: [1, 2, 3] }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'test-value',
      },
    });
  };

  const wrappedHandler = withSentry(mockHandler);
  const mockRequest = new Request('https://example.com/data', { method: 'POST' });
  const response = await wrappedHandler(mockRequest);

  assertEquals(response.status, 201);
  assertEquals(response.headers.get('X-Custom-Header'), 'test-value');
  const body = await response.json();
  assertEquals(body, { data: [1, 2, 3] });
});

// Restore Sentry DSN
if (originalDsn) {
  Deno.env.set('SENTRY_DSN', originalDsn);
}
