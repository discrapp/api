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

**Last Updated:** 2025-12-10

This file should be updated whenever:

- Project patterns change
- Important context is discovered
- Tooling is added or modified
