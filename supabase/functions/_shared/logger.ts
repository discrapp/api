/**
 * Structured logging utilities for Supabase Edge Functions
 *
 * Provides consistent JSON logging with context for debugging and monitoring.
 *
 * Usage:
 *   import { createLogger } from '../_shared/logger.ts';
 *
 *   const log = createLogger('create-sticker-order');
 *
 *   log.info('Processing order', { orderId: order.id, userId: user.id });
 *   log.error('Order creation failed', { error: error.message });
 */

/**
 * Log levels supported by the logger
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry format
 */
export interface LogEntry {
  level: LogLevel;
  function: string;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Logger interface with all log level methods
 */
export interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Output handler type for dependency injection
 */
export type OutputHandler = (entry: LogEntry) => void;

// Default output handler writes to console
const defaultOutputHandler: OutputHandler = (entry: LogEntry) => {
  const json = JSON.stringify(entry);
  if (entry.level === 'error') {
    console.error(json);
  } else if (entry.level === 'warn') {
    console.warn(json);
  } else if (entry.level === 'debug') {
    console.debug(json);
  } else {
    console.log(json);
  }
};

// Current output handler (can be overridden for testing)
let outputHandler: OutputHandler = defaultOutputHandler;

/**
 * Set a custom output handler (for testing)
 * @internal
 */
export function _setOutputHandler(handler: OutputHandler): void {
  outputHandler = handler;
}

/**
 * Reset to default output handler (for testing)
 * @internal
 */
export function _resetOutputHandler(): void {
  outputHandler = defaultOutputHandler;
}

/**
 * Create a log entry with all required fields
 */
function createLogEntry(
  level: LogLevel,
  functionName: string,
  message: string,
  context?: Record<string, unknown>
): LogEntry {
  return {
    level,
    function: functionName,
    message,
    ...context,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a logger for a specific function
 * @param functionName - The name of the edge function
 * @returns A logger instance with debug, info, warn, and error methods
 */
export function createLogger(functionName: string): Logger {
  return {
    debug: (message: string, context?: Record<string, unknown>) => {
      const entry = createLogEntry('debug', functionName, message, context);
      outputHandler(entry);
    },
    info: (message: string, context?: Record<string, unknown>) => {
      const entry = createLogEntry('info', functionName, message, context);
      outputHandler(entry);
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      const entry = createLogEntry('warn', functionName, message, context);
      outputHandler(entry);
    },
    error: (message: string, context?: Record<string, unknown>) => {
      const entry = createLogEntry('error', functionName, message, context);
      outputHandler(entry);
    },
  };
}
