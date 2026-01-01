/**
 * Shared Error Response Helper
 *
 * Provides consistent error response formatting across all edge functions.
 * Standardizes error format: { error: string, code?: string, details?: object }
 *
 * Usage:
 *   import { badRequest, unauthorized, notFound, internalError } from '../_shared/error-response.ts';
 *
 *   // Simple usage
 *   return badRequest('Invalid email format');
 *
 *   // With error code
 *   return badRequest('Email is required', ErrorCode.MISSING_FIELD);
 *
 *   // With details
 *   return badRequest('Validation failed', ErrorCode.INVALID_FIELD, { field: 'email' });
 */

/**
 * Standard HTTP status codes used across edge functions
 */
export const HttpStatus = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
} as const;

/**
 * Standard error codes for client-side error handling
 */
export const ErrorCode = {
  // Request validation errors
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_FIELD: 'INVALID_FIELD',

  // Authentication/Authorization errors
  MISSING_AUTH: 'MISSING_AUTH',
  INVALID_AUTH: 'INVALID_AUTH',
  FORBIDDEN: 'FORBIDDEN',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

/**
 * Error response body structure
 */
interface ErrorResponseBody {
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Creates a standardized error response
 *
 * @param message - Human-readable error message
 * @param status - HTTP status code
 * @param code - Optional machine-readable error code
 * @param details - Optional additional details object
 * @returns Response object with JSON body
 */
export function errorResponse(message: string, status: number, code?: string, details?: unknown): Response {
  const body: ErrorResponseBody = { error: message };

  if (code !== undefined) {
    body.code = code;
  }

  if (details !== undefined && details !== null) {
    body.details = details;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Returns a 400 Bad Request response
 *
 * @param message - Error message
 * @param code - Error code (defaults to INVALID_REQUEST)
 * @param details - Optional details
 */
export function badRequest(message: string, code: string = ErrorCode.INVALID_REQUEST, details?: unknown): Response {
  return errorResponse(message, HttpStatus.BAD_REQUEST, code, details);
}

/**
 * Returns a 401 Unauthorized response
 *
 * @param message - Error message
 * @param code - Error code (defaults to MISSING_AUTH)
 * @param details - Optional details
 */
export function unauthorized(message: string, code: string = ErrorCode.MISSING_AUTH, details?: unknown): Response {
  return errorResponse(message, HttpStatus.UNAUTHORIZED, code, details);
}

/**
 * Returns a 403 Forbidden response
 *
 * @param message - Error message
 * @param code - Error code (defaults to FORBIDDEN)
 * @param details - Optional details
 */
export function forbidden(message: string, code: string = ErrorCode.FORBIDDEN, details?: unknown): Response {
  return errorResponse(message, HttpStatus.FORBIDDEN, code, details);
}

/**
 * Returns a 404 Not Found response
 *
 * @param message - Error message
 * @param code - Error code (defaults to NOT_FOUND)
 * @param details - Optional details
 */
export function notFound(message: string, code: string = ErrorCode.NOT_FOUND, details?: unknown): Response {
  return errorResponse(message, HttpStatus.NOT_FOUND, code, details);
}

/**
 * Returns a 405 Method Not Allowed response
 *
 * @param message - Error message (defaults to 'Method not allowed')
 */
export function methodNotAllowed(message: string = 'Method not allowed'): Response {
  return errorResponse(message, HttpStatus.METHOD_NOT_ALLOWED, ErrorCode.METHOD_NOT_ALLOWED);
}

/**
 * Returns a 409 Conflict response
 *
 * @param message - Error message
 * @param code - Error code (defaults to CONFLICT)
 * @param details - Optional details
 */
export function conflict(message: string, code: string = ErrorCode.CONFLICT, details?: unknown): Response {
  return errorResponse(message, HttpStatus.CONFLICT, code, details);
}

/**
 * Returns a 429 Too Many Requests response
 *
 * @param message - Error message (defaults to 'Too many requests')
 * @param details - Optional details (e.g., { retry_after: 60 })
 */
export function tooManyRequests(message: string = 'Too many requests', details?: unknown): Response {
  return errorResponse(message, HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED, details);
}

/**
 * Returns a 500 Internal Server Error response
 *
 * @param message - Error message
 * @param code - Error code (defaults to INTERNAL_ERROR)
 * @param details - Optional details
 */
export function internalError(message: string, code: string = ErrorCode.INTERNAL_ERROR, details?: unknown): Response {
  return errorResponse(message, HttpStatus.INTERNAL_ERROR, code, details);
}
