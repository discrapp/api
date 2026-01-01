# Testing Documentation

## Overview

This project follows Test-Driven Development (TDD) with 100% code coverage from day
one.

## Testing Stack

- **Framework:** Jest (with ts-jest for TypeScript ESM support)
- **Coverage:** V8 (built into Jest)
- **CI/CD:** GitHub Actions with coverage enforcement

## Coverage Requirements

### Global Thresholds

- **Lines:** 100%
- **Branches:** 100%
- **Statements:** 100%
- **Functions:** 100% (except for schema files)

### Schema Files Exception

Schema definition files (`src/schema/*.ts`) are exempt from function coverage
requirements because:

1. They use Drizzle's builder pattern (`pgTable()`, `uuid()`, etc.)
1. These are declarative, not functional code
1. The builders themselves are tested by Drizzle ORM
1. We test the schema structure, not the builder implementation

**Important:** When adding business logic (API handlers, services, utilities), ALL
coverage metrics including functions MUST be at 100%.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests for a specific file
npm test src/schema/profiles.test.ts
```

## Test Organization

```text
src/
├── schema/
│   ├── profiles.ts           # Implementation
│   ├── profiles.test.ts      # Unit tests
│   ├── qr-codes.ts
│   ├── qr-codes.test.ts
│   └── schema-types.test.ts  # Type inference tests
└── ...
```

## Writing Tests

### Schema Tests

Test the structure and constraints of database tables:

```typescript
import { myTable } from './my-table';
import { getTableColumns, getTableName } from 'drizzle-orm';

describe('my_table schema', () => {
  it('should have the correct table name', () => {
    expect(getTableName(myTable)).toBe('my_table');
  });

  it('should have all required columns', () => {
    const columns = getTableColumns(myTable);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    // ... test all columns
  });

  it('should have id as UUID with default', () => {
    const columns = getTableColumns(myTable);
    expect(columns.id.dataType).toBe('string'); // UUID is string type
    expect(columns.id.notNull).toBe(true);
    expect(columns.id.primary).toBe(true);
  });

  // Test each column's properties...
});
```

### Validation Function Tests

Test business logic validators:

```typescript
describe('validateFlightNumbers', () => {
  it('should accept valid flight numbers', () => {
    const valid = {
      speed: 7,
      glide: 5,
      turn: 0,
      fade: 1,
    };

    expect(() => validateFlightNumbers(valid)).not.toThrow();
  });

  it('should reject speed below 1', () => {
    const invalid = {
      speed: 0,
      glide: 5,
      turn: 0,
      fade: 1,
    };

    expect(() => validateFlightNumbers(invalid)).toThrow(
      'Speed must be between 1 and 14'
    );
  });

  // Test all edge cases...
});
```

### Type Inference Tests

Ensure TypeScript types are correctly inferred:

```typescript
import type { Profile, NewProfile } from './profiles';

describe('schema type inference', () => {
  it('should infer Profile types correctly', () => {
    const newProfile: NewProfile = {
      username: 'testuser',
      email: 'test@example.com',
    };

    const profile: Profile = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      username: 'testuser',
      email: 'test@example.com',
      full_name: null,
      avatar_url: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(newProfile.username).toBe('testuser');
    expect(profile.id).toBeDefined();
  });
});
```

## Test-Driven Development Workflow

### 1. Write Failing Test

```typescript
it('should validate disc weight is positive', () => {
  const invalid = { weight: -1 /* ... */ };
  expect(() => validateDisc(invalid)).toThrow('Weight must be positive');
});
```

### 2. Run Tests (Should Fail)

```bash
npm test
# ❌ Test fails - validateDisc doesn't exist yet
```

### 3. Implement Minimum Code to Pass

```typescript
export function validateDisc(disc: any): void {
  if (disc.weight && disc.weight < 0) {
    throw new Error('Weight must be positive');
  }
}
```

### 4. Run Tests (Should Pass)

```bash
npm test
# ✅ Test passes
```

### 5. Refactor (Maintain Tests Passing)

```typescript
export function validateDisc(disc: Partial<Disc>): void {
  if (disc.weight !== undefined && disc.weight < 0) {
    throw new Error('Weight must be positive');
  }
}
```

### 6. Verify Coverage

```bash
npm run test:coverage
# ✅ 100% coverage maintained
```

## CI/CD Integration

Tests run automatically on every PR via GitHub Actions:

```yaml
jobs:
  test:
    uses: 'appdiscr/.github/.github/workflows/test.yml@main'
    permissions:
      contents: read
      pull-requests: write
```

The workflow:

1. Installs dependencies
1. Runs tests with coverage
1. Enforces 100% coverage thresholds
1. Uploads coverage reports to Codecov
1. Fails the build if coverage drops below 100%

## Best Practices

### DO

- ✅ Write tests BEFORE implementation
- ✅ Test edge cases and boundary conditions
- ✅ Keep tests focused and single-purpose
- ✅ Use descriptive test names
- ✅ Maintain 100% coverage
- ✅ Run tests before committing

### DON'T

- ❌ Skip tests for "simple" code
- ❌ Write implementation before tests
- ❌ Test implementation details
- ❌ Use `any` types in tests
- ❌ Commit code without running tests
- ❌ Lower coverage thresholds

## Debugging Tests

### Run Specific Test

```bash
npm test -- --reporter=verbose src/schema/profiles.test.ts
```

### Watch Mode

```bash
npm run test:watch
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Tests",
  "runtimeExecutable": "node",
  "runtimeArgs": [
    "--experimental-vm-modules",
    "${workspaceFolder}/node_modules/jest/bin/jest.js",
    "--runInBand"
  ],
  "console": "integratedTerminal"
}
```

## Coverage Reports

After running `npm run test:coverage`, reports are generated:

- **Text:** Displayed in terminal
- **HTML:** `coverage/index.html` (open in browser)
- **LCOV:** `coverage/lcov.info` (for CI tools)
- **JSON:** `coverage/coverage-summary.json` (for scripts)

View HTML report:

```bash
open coverage/index.html
```

## Future Testing

As the project grows, we'll add:

1. **Integration Tests:** Test database operations with local Supabase
1. **E2E Tests:** Test API endpoints
1. **Performance Tests:** Benchmark critical operations
1. **Contract Tests:** Verify API contracts with mobile app

All new test types will maintain 100% coverage requirements.
