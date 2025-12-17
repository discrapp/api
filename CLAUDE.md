# AceBack API - Project Memory

This file contains persistent context for Claude Code sessions on this project.
It will be automatically loaded at the start of every session.

## Project Overview

This is the Supabase backend for AceBack, containing database migrations, edge
functions, and API configuration.

**Key Details:**

- **Backend:** Supabase (PostgreSQL, Edge Functions, Auth, Storage)
- **Database:** PostgreSQL 17
- **Migrations:** Supabase CLI migration system
- **Edge Functions:** Deno-based serverless functions
- **CI/CD:** GitHub Actions with release workflow
- **Linting:** Pre-commit hooks for code quality

## Repository Structure

```text
api/
├── .github/workflows/     # CI/CD workflows
├── supabase/
│   ├── migrations/        # Database migrations
│   ├── functions/         # Edge functions (Deno)
│   └── config.toml        # Supabase configuration
├── .env                   # Environment variables (DO NOT COMMIT)
├── .env.example           # Environment template
└── README.md
```

## Supabase Project Details

- **Project Name:** aceback-mvp
- **Project Ref:** xhaogdigrsiwxdjmjzgx
- **Region:** us-west-2
- **Database:** PostgreSQL 17.6.1.054
- **Dashboard:** <https://app.supabase.com/project/xhaogdigrsiwxdjmjzgx>

## Development Setup

### Prerequisites

- Supabase CLI
- Node.js 18+ and npm (for edge functions)

### Environment Variables

The `.env` file contains:

- `SUPABASE_PROJECT_REF` - Project reference ID
- `SUPABASE_URL` - API endpoint
- `SUPABASE_ANON_KEY` - Anonymous key (safe for client use)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (server-only, keep secure!)
- `DATABASE_URL` - PostgreSQL connection string

### Common Commands

```bash
# Link to Supabase project
supabase link --project-ref xhaogdigrsiwxdjmjzgx

# Create new migration
supabase migration new migration_name

# Apply migrations locally (requires local Supabase)
supabase db reset

# NOTE: Do NOT run 'supabase db push' locally!
# Migrations are pushed via CI/CD on PR merge

# Create new edge function
supabase functions new function_name

# Serve functions locally
supabase functions serve

# Deploy functions (done via CI/CD on PR merge)
# supabase functions deploy function_name
```

## Git Workflow

**CRITICAL:** All changes MUST go through Pull Requests. Never commit directly
to main.

1. **Create feature branch:** `git checkout -b feature/description`
1. **Make changes** to migrations or functions
1. **Write markdown correctly the FIRST time** - Use markdownlint style:
   - Keep lines under 80 characters (break long lines manually)
   - Use `1.` for all ordered list items (auto-numbered)
   - Add blank lines around fenced code blocks
   - Do NOT rely on pre-commit hooks to fix formatting
1. **Run type checking BEFORE committing:**
   `deno check supabase/functions/**/*.ts`
   - Fix ALL type errors before proceeding
1. **ALWAYS run pre-commit BEFORE committing:** `pre-commit run --all-files`
   - Fix ALL errors before committing
   - Do NOT commit with `--no-verify` unless absolutely necessary
1. **Commit with conventional format:** `git commit -m "type: description"`
1. **Push and create PR:** `gh pr create --title "feat: description"`
1. **Get PR reviewed and merged** - Never push directly to main

**Commit Format:** Conventional Commits (enforced by pre-commit hook)

- `feat:` - New feature (triggers minor version bump)
- `fix:` - Bug fix (triggers patch version bump)
- `docs:` - Documentation changes (no version bump)
- `chore:` - Maintenance (no version bump)
- `refactor:` - Code refactoring (no version bump)

## Pre-commit Hooks

**Installed hooks:**

- YAML linting (yamllint)
- Markdown linting (markdownlint)
- Conventional commit format
- File hygiene (trailing whitespace, EOF, etc.)

**Setup:**

```bash
pre-commit install              # One-time setup
pre-commit run --all-files      # Run manually
pre-commit autoupdate           # Update hook versions
```

## Important Notes

### Test-Driven Development (TDD) - MANDATORY

**CRITICAL:** All new code MUST be developed using Test-Driven Development:

1. **Write tests FIRST** - Before writing any implementation code, write tests
1. **Red-Green-Refactor cycle:**
   - RED: Write a failing test for the new functionality
   - GREEN: Write minimal code to make the test pass
   - REFACTOR: Clean up while keeping tests green
1. **Test coverage requirements:**
   - All edge functions must have unit tests
   - All database operations must be tested
   - All error paths must be covered
1. **Test file locations:**
   - Tests go in `supabase/functions/<function-name>/*.test.ts`
   - Use Deno's built-in test runner
1. **Running tests:**

   ```bash
   deno test supabase/functions/
   ```

**DO NOT write implementation code without tests. This is non-negotiable.**

### Test Mocking - REQUIRED

**CRITICAL:** All tests MUST use mocked Supabase clients. Do NOT use real database
connections in tests.

**Why mocking is required:**

- Eliminates API costs from database calls during test runs
- Tests run faster without network latency
- Tests are isolated and deterministic
- No test data pollution in production database

**Mocking pattern:**

```typescript
// Type definitions for mock data
interface MockUser {
  id: string;
  email: string;
}

interface MockDisc {
  id: string;
  owner_id: string;
  name: string;
}

// Mock data arrays
let mockUsers: MockUser[] = [];
let mockDiscs: MockDisc[] = [];

// Reset function for test isolation
function resetMocks() {
  mockUsers = [];
  mockDiscs = [];
}

// Mock Supabase client factory
function mockSupabaseClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === 'discs') {
              const disc = mockDiscs[0];
              return {
                data: disc || null,
                error: disc ? null : { code: 'PGRST116' },
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'new-id' }, error: null }),
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: mockDiscs[0], error: null }),
          }),
        }),
      }),
      delete: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
    auth: {
      getUser: async () => ({
        data: { user: mockUsers[0] || null },
        error: mockUsers[0] ? null : { message: 'No user' },
      }),
    },
  };
}

// Use in tests
Deno.test('example test', async () => {
  resetMocks();
  mockUsers.push({ id: 'user-1', email: 'test@example.com' });
  mockDiscs.push({ id: 'disc-1', owner_id: 'user-1', name: 'Test Disc' });

  // Test implementation using mockSupabaseClient()
});
```

**Key patterns:**

- Always call `resetMocks()` at the start of each test
- Use typed mock data interfaces for type safety
- Configure mock return values based on test scenario
- Test both success and error paths

### Mock Type Safety - CRITICAL

When writing mocked tests, ensure type safety to catch errors at compile time:

**1. Empty object literals need explicit types:**

```typescript
// BAD - TypeScript infers {} with no properties
const body = {};
if (!body.order_id) { ... }  // Error: Property 'order_id' doesn't exist

// GOOD - Explicitly type the object
const body: { order_id?: string } = {};
if (!body.order_id) { ... }  // Works correctly
```

**2. Mock return types with union types need assertions:**

```typescript
// When mock returns MockDisc | MockRecoveryEvent:
const result = await mockSupabaseClient.from('discs').select('*').eq('id', id).single();
assertExists(result.data);

// BAD - result.data is union type, owner_id doesn't exist on MockRecoveryEvent
if (result.data.owner_id === userId) { ... }  // Type error!

// GOOD - Assert the specific type
const disc = result.data as MockDisc;
if (disc.owner_id === userId) { ... }  // Works correctly
```

**3. Mock client method chains must match Supabase API:**

```typescript
// BAD - .in() takes only statuses, but Supabase API takes (column, values)
in: (statuses: string[]) => ({ ... })

// GOOD - Match Supabase signature: .in(column, values)
in: (column: string, values: string[]) => ({ ... })
```

**4. Filter callbacks need explicit parameter types:**

```typescript
// BAD - 'n' has implicit 'any' type
result.data.filter((n) => !n.read)

// GOOD - Explicitly type the parameter
result.data.filter((n: MockNotification) => !n.read)
```

**5. Mock type definitions must include all fields used in tests:**

```typescript
// If tests check printed_at, tracking_number, shipped_at:
type MockOrderData = {
  id: string;
  status: string;
  order_number: string;
  printed_at?: string | null;      // Include if tests use it
  tracking_number?: string | null; // Include if tests use it
  shipped_at?: string | null;      // Include if tests use it
};
```

**Always run `deno check` before committing to catch type errors early.**

### ESLint Compliance - CRITICAL

**CRITICAL:** All code MUST pass ESLint from the start. Do not rely on linters to
fix issues - write clean code first.

**Key rules:**

**1. Prefix unused function parameters with `_`:**

```typescript
// BAD - ESLint error: 'columns' is defined but never used
select: (columns?: string) => ({ ... })

// GOOD - Underscore prefix indicates intentionally unused
select: (_columns?: string) => ({ ... })
```

**2. Don't assign variables you won't use:**

```typescript
// BAD - ESLint error: 'totalPrice' is assigned but never used
const totalPrice = calculatePrice();  // Not used anywhere

// GOOD - Either use the variable or don't create it
// Remove the line if the value isn't needed in the test
```

**3. Use `const` for variables that aren't reassigned:**

```typescript
// BAD - ESLint error: 'url' is never reassigned, use const
let url = 'https://example.com';

// GOOD
const url = 'https://example.com';
```

**4. Avoid `any` types - use proper typing:**

```typescript
// BAD - ESLint error: Unexpected any
const result = await (client as any).from('table').select();

// GOOD - Properly type your mocks or use type assertions
const result = await client.from('table').select();
// Or add /* eslint-disable @typescript-eslint/no-explicit-any */ at file top
// only as a last resort for complex mock scenarios
```

**Run `npx eslint <file>` before committing to catch errors early.**

### Code Quality Standards

**CRITICAL:** All code must adhere to linter and prettier rules from the start.

- **Write prettier-compliant code** - Don't rely on pre-commit hooks to fix
  formatting. This wastes cycles and creates noisy diffs.
- Use 2-space indentation, single quotes, trailing commas
- Keep lines under 100 characters for TypeScript

### Drizzle Schema Coverage

When adding `.references()` to Drizzle schema tables, you MUST add a coverage
ignore comment. Drizzle uses lazy-evaluated arrow function callbacks that are
executed internally by Drizzle, not by application code, making them untestable.

**Pattern:**

```typescript
// CORRECT - add inline ignore comment before the arrow function
column_id: uuid('column_id')
  .references(/* c8 ignore next */ () => otherTable.id, { onDelete: 'cascade' })
  .notNull(),

// Also works for single-line references
other_id: uuid('other_id').references(/* c8 ignore next */ () => otherTable.id, {
  onDelete: 'set null',
}),
```

**Why:** V8 coverage tracks these callbacks as uncovered functions. Since they
are framework configuration (not business logic), we exclude them from coverage.

### Database Migrations

- Always create migrations for schema changes
- Never modify existing migrations after they're merged
- Use descriptive migration names
- **NEVER run `supabase db push` locally** - Migrations are pushed to production
  automatically via CI/CD when PRs are merged to main
- To test migrations locally, use `supabase db reset` (requires local Supabase)

### Edge Functions

- Written in TypeScript/Deno
- No Node.js runtime - use Deno APIs
- Handle errors gracefully
- Validate all inputs
- Use environment variables for configuration

### Security

- NEVER commit `.env` file
- Service role key has full database access - keep secure
- Use RLS (Row Level Security) policies
- Validate all user inputs
- Use parameterized queries

## References

- @README.md - Repository overview
- Supabase Documentation: <https://supabase.com/docs>
- Supabase CLI Reference: <https://supabase.com/docs/reference/cli>
- Deno Documentation: <https://deno.land/manual>

---

**Last Updated:** 2025-12-17

This file should be updated whenever:

- Project patterns change
- Important context is discovered
- Tooling is added or modified
