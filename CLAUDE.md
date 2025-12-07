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

# Apply migrations locally
supabase db reset

# Push migrations to production
supabase db push

# Create new edge function
supabase functions new function_name

# Serve functions locally
supabase functions serve

# Deploy functions
supabase functions deploy function_name
```

## Git Workflow

1. **Create feature branch:** `git checkout -b feature/description`
1. **Make changes** to migrations or functions
1. **ALWAYS run pre-commit BEFORE committing:** `pre-commit run --all-files`
   - Fix ALL errors (especially markdown and YAML formatting)
   - Do NOT commit with `--no-verify` unless absolutely necessary
1. **Commit with conventional format:** `git commit -m "type: description"`
1. **Push and create PR:** `gh pr create --title "feat: description"`
1. **Merge to main:** Automatic release created based on commits

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

### Code Quality Standards

**CRITICAL:** All code must adhere to linter rules from the start.

### Database Migrations

- Always create migrations for schema changes
- Never modify existing migrations after they're merged
- Test migrations locally before pushing
- Use descriptive migration names

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

**Last Updated:** 2025-11-30

This file should be updated whenever:

- Project patterns change
- Important context is discovered
- Tooling is added or modified
