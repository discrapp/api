import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      'node_modules/**',
      'supabase/functions/**', // Deno edge function tests
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      thresholds: {
        // 100% coverage for lines, branches, and statements
        // Function coverage not enforced for schema files (Drizzle builder functions)
        // but will be enforced at 100% for all business logic code
        lines: 100,
        branches: 100,
        statements: 100,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.config.ts',
        '**/*.config.js',
        '**/*.d.ts',
        'tests/**',
        'src/schema/index.ts',
        'src/db/index.ts',
        'supabase/functions/**', // Deno edge function tests
      ],
    },
  },
});
