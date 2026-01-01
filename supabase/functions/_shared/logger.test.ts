import { assertEquals, assertExists } from 'jsr:@std/assert';
import { createLogger, _setOutputHandler, _resetOutputHandler, LogEntry } from './logger.ts';

// Helper to capture log output
function captureLogOutput(callback: () => void): LogEntry[] {
  const captured: LogEntry[] = [];
  _setOutputHandler((entry: LogEntry) => {
    captured.push(entry);
  });
  callback();
  _resetOutputHandler();
  return captured;
}

// Test 1: createLogger should be exported and return a logger object
Deno.test('logger: createLogger should be exported', async () => {
  const logger = await import('./logger.ts');
  assertExists(logger.createLogger, 'createLogger should be exported');
  assertEquals(typeof logger.createLogger, 'function');
});

// Test 2: Logger should have info method
Deno.test('logger: should have info method', () => {
  const log = createLogger('test-function');
  assertExists(log.info, 'logger should have info method');
  assertEquals(typeof log.info, 'function');
});

// Test 3: Logger should have error method
Deno.test('logger: should have error method', () => {
  const log = createLogger('test-function');
  assertExists(log.error, 'logger should have error method');
  assertEquals(typeof log.error, 'function');
});

// Test 4: Logger should have warn method
Deno.test('logger: should have warn method', () => {
  const log = createLogger('test-function');
  assertExists(log.warn, 'logger should have warn method');
  assertEquals(typeof log.warn, 'function');
});

// Test 5: Logger should have debug method
Deno.test('logger: should have debug method', () => {
  const log = createLogger('test-function');
  assertExists(log.debug, 'logger should have debug method');
  assertEquals(typeof log.debug, 'function');
});

// Test 6: info should output structured JSON with required fields
Deno.test('logger: info outputs structured JSON with level, function, message, timestamp', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.info('Test message');
  });

  assertEquals(captured.length, 1);
  const entry = captured[0];
  assertEquals(entry.level, 'info');
  assertEquals(entry.function, 'test-function');
  assertEquals(entry.message, 'Test message');
  assertExists(entry.timestamp);
});

// Test 7: error should output with level 'error'
Deno.test('logger: error outputs with level error', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.error('Error message');
  });

  assertEquals(captured.length, 1);
  assertEquals(captured[0].level, 'error');
  assertEquals(captured[0].message, 'Error message');
});

// Test 8: warn should output with level 'warn'
Deno.test('logger: warn outputs with level warn', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.warn('Warning message');
  });

  assertEquals(captured.length, 1);
  assertEquals(captured[0].level, 'warn');
  assertEquals(captured[0].message, 'Warning message');
});

// Test 9: debug should output with level 'debug'
Deno.test('logger: debug outputs with level debug', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.debug('Debug message');
  });

  assertEquals(captured.length, 1);
  assertEquals(captured[0].level, 'debug');
  assertEquals(captured[0].message, 'Debug message');
});

// Test 10: info should include context in output
Deno.test('logger: info includes context in output', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.info('Processing order', { orderId: 'order-123', userId: 'user-456' });
  });

  assertEquals(captured.length, 1);
  assertEquals(captured[0].orderId, 'order-123');
  assertEquals(captured[0].userId, 'user-456');
});

// Test 11: error should include context in output
Deno.test('logger: error includes context in output', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.error('Order failed', { error: 'Payment declined', orderId: 'order-789' });
  });

  assertEquals(captured.length, 1);
  assertEquals(captured[0].error, 'Payment declined');
  assertEquals(captured[0].orderId, 'order-789');
});

// Test 12: timestamp should be in ISO format
Deno.test('logger: timestamp is in ISO 8601 format', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.info('Test message');
  });

  assertEquals(captured.length, 1);
  const timestamp = captured[0].timestamp;
  // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
  assertEquals(isoRegex.test(timestamp), true, `Timestamp should be ISO format: ${timestamp}`);
});

// Test 13: different function names should be preserved
Deno.test('logger: different function names are preserved', () => {
  const log1 = createLogger('create-order');
  const log2 = createLogger('delete-order');

  const captured: LogEntry[] = [];
  _setOutputHandler((entry: LogEntry) => {
    captured.push(entry);
  });

  log1.info('Creating order');
  log2.info('Deleting order');

  _resetOutputHandler();

  assertEquals(captured.length, 2);
  assertEquals(captured[0].function, 'create-order');
  assertEquals(captured[1].function, 'delete-order');
});

// Test 14: context should not override required fields
Deno.test('logger: timestamp is always last (not overridable)', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    // Trying to override timestamp in context
    log.info('Test message', { timestamp: 'fake-timestamp' });
  });

  assertEquals(captured.length, 1);
  // The timestamp should be a valid ISO timestamp, not 'fake-timestamp'
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
  assertEquals(isoRegex.test(captured[0].timestamp), true);
});

// Test 15: empty context should work
Deno.test('logger: works without context', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.info('Simple message');
    log.error('Error message');
    log.warn('Warn message');
    log.debug('Debug message');
  });

  assertEquals(captured.length, 4);
});

// Test 16: complex nested context should be preserved
Deno.test('logger: complex nested context is preserved', () => {
  const log = createLogger('test-function');
  const captured = captureLogOutput(() => {
    log.info('Processing request', {
      user: { id: 'user-1', email: 'test@example.com' },
      items: [1, 2, 3],
      metadata: { source: 'api', version: '1.0' },
    });
  });

  assertEquals(captured.length, 1);
  const entry = captured[0];
  assertEquals((entry.user as { id: string; email: string }).id, 'user-1');
  assertEquals((entry.items as number[]).length, 3);
  assertEquals((entry.metadata as { source: string }).source, 'api');
});

// Test 17: default output handler should use console.log for info
Deno.test('logger: default handler uses console.log for info level', () => {
  const log = createLogger('test-function');
  const originalLog = console.log;
  let logOutput = '';
  console.log = (msg: string) => {
    logOutput = msg;
  };

  // Call without custom handler (uses default)
  _resetOutputHandler();
  log.info('Info message');

  // Restore
  console.log = originalLog;

  // Verify JSON was output
  const parsed = JSON.parse(logOutput);
  assertEquals(parsed.level, 'info');
  assertEquals(parsed.message, 'Info message');
});

// Test 18: default output handler should use console.error for error level
Deno.test('logger: default handler uses console.error for error level', () => {
  const log = createLogger('test-function');
  const originalError = console.error;
  let errorOutput = '';
  console.error = (msg: string) => {
    errorOutput = msg;
  };

  // Call without custom handler (uses default)
  _resetOutputHandler();
  log.error('Error message');

  // Restore
  console.error = originalError;

  // Verify JSON was output
  const parsed = JSON.parse(errorOutput);
  assertEquals(parsed.level, 'error');
  assertEquals(parsed.message, 'Error message');
});

// Test 19: default output handler should use console.warn for warn level
Deno.test('logger: default handler uses console.warn for warn level', () => {
  const log = createLogger('test-function');
  const originalWarn = console.warn;
  let warnOutput = '';
  console.warn = (msg: string) => {
    warnOutput = msg;
  };

  // Call without custom handler (uses default)
  _resetOutputHandler();
  log.warn('Warn message');

  // Restore
  console.warn = originalWarn;

  // Verify JSON was output
  const parsed = JSON.parse(warnOutput);
  assertEquals(parsed.level, 'warn');
  assertEquals(parsed.message, 'Warn message');
});

// Test 20: default output handler should use console.debug for debug level
Deno.test('logger: default handler uses console.debug for debug level', () => {
  const log = createLogger('test-function');
  const originalDebug = console.debug;
  let debugOutput = '';
  console.debug = (msg: string) => {
    debugOutput = msg;
  };

  // Call without custom handler (uses default)
  _resetOutputHandler();
  log.debug('Debug message');

  // Restore
  console.debug = originalDebug;

  // Verify JSON was output
  const parsed = JSON.parse(debugOutput);
  assertEquals(parsed.level, 'debug');
  assertEquals(parsed.message, 'Debug message');
});
