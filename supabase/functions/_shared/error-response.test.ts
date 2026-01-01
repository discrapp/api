import { assertEquals, assertExists } from 'https://deno.land/std@0.192.0/testing/asserts.ts';
import {
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  conflict,
  tooManyRequests,
  internalError,
  HttpStatus,
  ErrorCode,
} from './error-response.ts';

// Helper to parse response body
async function parseResponseBody(response: Response): Promise<{ error: string; code?: string; details?: unknown }> {
  return await response.json();
}

// =============================================================================
// HttpStatus constants tests
// =============================================================================

Deno.test('HttpStatus: should have correct status code values', () => {
  assertEquals(HttpStatus.BAD_REQUEST, 400);
  assertEquals(HttpStatus.UNAUTHORIZED, 401);
  assertEquals(HttpStatus.FORBIDDEN, 403);
  assertEquals(HttpStatus.NOT_FOUND, 404);
  assertEquals(HttpStatus.METHOD_NOT_ALLOWED, 405);
  assertEquals(HttpStatus.CONFLICT, 409);
  assertEquals(HttpStatus.TOO_MANY_REQUESTS, 429);
  assertEquals(HttpStatus.INTERNAL_ERROR, 500);
});

// =============================================================================
// ErrorCode constants tests
// =============================================================================

Deno.test('ErrorCode: should have expected error code strings', () => {
  assertEquals(ErrorCode.INVALID_REQUEST, 'INVALID_REQUEST');
  assertEquals(ErrorCode.INVALID_JSON, 'INVALID_JSON');
  assertEquals(ErrorCode.MISSING_FIELD, 'MISSING_FIELD');
  assertEquals(ErrorCode.INVALID_FIELD, 'INVALID_FIELD');
  assertEquals(ErrorCode.MISSING_AUTH, 'MISSING_AUTH');
  assertEquals(ErrorCode.INVALID_AUTH, 'INVALID_AUTH');
  assertEquals(ErrorCode.FORBIDDEN, 'FORBIDDEN');
  assertEquals(ErrorCode.NOT_FOUND, 'NOT_FOUND');
  assertEquals(ErrorCode.METHOD_NOT_ALLOWED, 'METHOD_NOT_ALLOWED');
  assertEquals(ErrorCode.CONFLICT, 'CONFLICT');
  assertEquals(ErrorCode.RATE_LIMITED, 'RATE_LIMITED');
  assertEquals(ErrorCode.INTERNAL_ERROR, 'INTERNAL_ERROR');
  assertEquals(ErrorCode.DATABASE_ERROR, 'DATABASE_ERROR');
});

// =============================================================================
// errorResponse function tests
// =============================================================================

Deno.test('errorResponse: should return Response with correct status', async () => {
  const response = errorResponse('Test error', 400);
  assertEquals(response.status, 400);
});

Deno.test('errorResponse: should return Response with JSON content-type', async () => {
  const response = errorResponse('Test error', 400);
  assertEquals(response.headers.get('Content-Type'), 'application/json');
});

Deno.test('errorResponse: should include error message in body', async () => {
  const response = errorResponse('Test error message', 400);
  const body = await parseResponseBody(response);
  assertEquals(body.error, 'Test error message');
});

Deno.test('errorResponse: should include error code when provided', async () => {
  const response = errorResponse('Test error', 400, 'TEST_CODE');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'TEST_CODE');
});

Deno.test('errorResponse: should not include code when not provided', async () => {
  const response = errorResponse('Test error', 400);
  const body = await parseResponseBody(response);
  assertEquals(body.code, undefined);
});

Deno.test('errorResponse: should include details when provided', async () => {
  const details = { field: 'email', reason: 'invalid format' };
  const response = errorResponse('Test error', 400, 'TEST_CODE', details);
  const body = await parseResponseBody(response);
  assertEquals(body.details, details);
});

Deno.test('errorResponse: should not include details when not provided', async () => {
  const response = errorResponse('Test error', 400, 'TEST_CODE');
  const body = await parseResponseBody(response);
  assertEquals(body.details, undefined);
});

Deno.test('errorResponse: should handle null details', async () => {
  const response = errorResponse('Test error', 400, 'TEST_CODE', null);
  const body = await parseResponseBody(response);
  assertEquals(body.details, undefined);
});

Deno.test('errorResponse: should handle undefined details', async () => {
  const response = errorResponse('Test error', 400, 'TEST_CODE', undefined);
  const body = await parseResponseBody(response);
  assertEquals(body.details, undefined);
});

Deno.test('errorResponse: should handle complex details object', async () => {
  const details = {
    errors: [
      { field: 'name', message: 'required' },
      { field: 'email', message: 'invalid' },
    ],
    meta: { timestamp: '2024-01-01' },
  };
  const response = errorResponse('Validation failed', 400, 'VALIDATION_ERROR', details);
  const body = await parseResponseBody(response);
  assertEquals(body.details, details);
});

Deno.test('errorResponse: should work with all status codes', async () => {
  const statusCodes = [400, 401, 403, 404, 405, 409, 429, 500, 502, 503];
  for (const status of statusCodes) {
    const response = errorResponse('Test', status);
    assertEquals(response.status, status);
  }
});

// =============================================================================
// badRequest helper tests
// =============================================================================

Deno.test('badRequest: should return 400 status', async () => {
  const response = badRequest('Invalid input');
  assertEquals(response.status, 400);
});

Deno.test('badRequest: should use INVALID_REQUEST code by default', async () => {
  const response = badRequest('Invalid input');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'INVALID_REQUEST');
});

Deno.test('badRequest: should allow custom error code', async () => {
  const response = badRequest('Invalid input', 'CUSTOM_CODE');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'CUSTOM_CODE');
});

Deno.test('badRequest: should include details when provided', async () => {
  const details = { field: 'name' };
  const response = badRequest('Invalid input', 'MISSING_FIELD', details);
  const body = await parseResponseBody(response);
  assertEquals(body.details, details);
});

// =============================================================================
// unauthorized helper tests
// =============================================================================

Deno.test('unauthorized: should return 401 status', async () => {
  const response = unauthorized('Not authenticated');
  assertEquals(response.status, 401);
});

Deno.test('unauthorized: should use MISSING_AUTH code by default', async () => {
  const response = unauthorized('Missing authorization');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'MISSING_AUTH');
});

Deno.test('unauthorized: should allow custom error code', async () => {
  const response = unauthorized('Token expired', 'TOKEN_EXPIRED');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'TOKEN_EXPIRED');
});

// =============================================================================
// forbidden helper tests
// =============================================================================

Deno.test('forbidden: should return 403 status', async () => {
  const response = forbidden('Access denied');
  assertEquals(response.status, 403);
});

Deno.test('forbidden: should use FORBIDDEN code by default', async () => {
  const response = forbidden('Access denied');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'FORBIDDEN');
});

Deno.test('forbidden: should include error message', async () => {
  const response = forbidden('You do not own this disc');
  const body = await parseResponseBody(response);
  assertEquals(body.error, 'You do not own this disc');
});

// =============================================================================
// notFound helper tests
// =============================================================================

Deno.test('notFound: should return 404 status', async () => {
  const response = notFound('Disc not found');
  assertEquals(response.status, 404);
});

Deno.test('notFound: should use NOT_FOUND code by default', async () => {
  const response = notFound('Resource not found');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'NOT_FOUND');
});

Deno.test('notFound: should include details when provided', async () => {
  const details = { resource: 'disc', id: '123' };
  const response = notFound('Disc not found', 'NOT_FOUND', details);
  const body = await parseResponseBody(response);
  assertEquals(body.details, details);
});

// =============================================================================
// methodNotAllowed helper tests
// =============================================================================

Deno.test('methodNotAllowed: should return 405 status', async () => {
  const response = methodNotAllowed();
  assertEquals(response.status, 405);
});

Deno.test('methodNotAllowed: should use default message', async () => {
  const response = methodNotAllowed();
  const body = await parseResponseBody(response);
  assertEquals(body.error, 'Method not allowed');
});

Deno.test('methodNotAllowed: should use METHOD_NOT_ALLOWED code', async () => {
  const response = methodNotAllowed();
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'METHOD_NOT_ALLOWED');
});

Deno.test('methodNotAllowed: should allow custom message', async () => {
  const response = methodNotAllowed('Only POST requests are supported');
  const body = await parseResponseBody(response);
  assertEquals(body.error, 'Only POST requests are supported');
});

// =============================================================================
// conflict helper tests
// =============================================================================

Deno.test('conflict: should return 409 status', async () => {
  const response = conflict('Resource already exists');
  assertEquals(response.status, 409);
});

Deno.test('conflict: should use CONFLICT code by default', async () => {
  const response = conflict('Duplicate entry');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'CONFLICT');
});

Deno.test('conflict: should include details when provided', async () => {
  const details = { existing_id: 'abc123' };
  const response = conflict('Already exists', 'DUPLICATE', details);
  const body = await parseResponseBody(response);
  assertEquals(body.details, details);
});

// =============================================================================
// tooManyRequests helper tests
// =============================================================================

Deno.test('tooManyRequests: should return 429 status', async () => {
  const response = tooManyRequests();
  assertEquals(response.status, 429);
});

Deno.test('tooManyRequests: should use default message', async () => {
  const response = tooManyRequests();
  const body = await parseResponseBody(response);
  assertEquals(body.error, 'Too many requests');
});

Deno.test('tooManyRequests: should use RATE_LIMITED code', async () => {
  const response = tooManyRequests();
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'RATE_LIMITED');
});

Deno.test('tooManyRequests: should allow custom message', async () => {
  const response = tooManyRequests('Slow down, please wait 60 seconds');
  const body = await parseResponseBody(response);
  assertEquals(body.error, 'Slow down, please wait 60 seconds');
});

Deno.test('tooManyRequests: should include retry details when provided', async () => {
  const details = { retry_after: 60 };
  const response = tooManyRequests('Rate limited', details);
  const body = await parseResponseBody(response);
  assertEquals(body.details, details);
});

// =============================================================================
// internalError helper tests
// =============================================================================

Deno.test('internalError: should return 500 status', async () => {
  const response = internalError('Something went wrong');
  assertEquals(response.status, 500);
});

Deno.test('internalError: should use INTERNAL_ERROR code by default', async () => {
  const response = internalError('Server error');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'INTERNAL_ERROR');
});

Deno.test('internalError: should allow DATABASE_ERROR code', async () => {
  const response = internalError('Failed to save', 'DATABASE_ERROR');
  const body = await parseResponseBody(response);
  assertEquals(body.code, 'DATABASE_ERROR');
});

Deno.test('internalError: should include details when provided', async () => {
  const details = { operation: 'insert', table: 'discs' };
  const response = internalError('Database error', 'DATABASE_ERROR', details);
  const body = await parseResponseBody(response);
  assertEquals(body.details, details);
});

// =============================================================================
// Integration-style tests
// =============================================================================

Deno.test('errorResponse: response body should be valid JSON', async () => {
  const response = errorResponse('Test', 400, 'TEST', { foo: 'bar' });
  const text = await response.clone().text();
  const parsed = JSON.parse(text);
  assertExists(parsed.error);
});

Deno.test('helper functions: should all return Response objects', () => {
  const responses = [
    badRequest('test'),
    unauthorized('test'),
    forbidden('test'),
    notFound('test'),
    methodNotAllowed(),
    conflict('test'),
    tooManyRequests(),
    internalError('test'),
  ];

  for (const response of responses) {
    assertExists(response);
    assertEquals(response instanceof Response, true);
  }
});

Deno.test('error body format: should match expected structure', async () => {
  const response = errorResponse('Error message', 400, 'ERROR_CODE', {
    detail: 'value',
  });
  const body = await parseResponseBody(response);

  // Verify all expected keys
  assertEquals(typeof body.error, 'string');
  assertEquals(typeof body.code, 'string');
  assertEquals(typeof body.details, 'object');

  // Verify values
  assertEquals(body.error, 'Error message');
  assertEquals(body.code, 'ERROR_CODE');
  assertEquals(body.details, { detail: 'value' });
});
