/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: ['**/src/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/supabase/functions/', // Deno edge function tests
  ],
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  coverageReporters: ['text', 'json', 'json-summary', 'html', 'lcov'],
  coverageThreshold: {
    global: {
      // 100% coverage for lines, branches, and statements
      // Function coverage not enforced for schema files (Drizzle builder functions)
      // but will be enforced at 100% for all business logic code
      lines: 100,
      branches: 100,
      statements: 100,
    },
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '.*\\.config\\.(ts|js)$',
    '.*\\.d\\.ts$',
    '/tests/',
    'src/schema/index.ts',
    'src/db/index.ts',
    '/supabase/functions/', // Deno edge function tests
  ],
};
