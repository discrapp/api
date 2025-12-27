# Discr API

![GitHub branch status](https://img.shields.io/github/checks-status/discrapp/api/main)
![GitHub Issues](https://img.shields.io/github/issues/discrapp/api)
![GitHub last commit](https://img.shields.io/github/last-commit/discrapp/api)
![GitHub repo size](https://img.shields.io/github/repo-size/discrapp/api)
![GitHub License](https://img.shields.io/github/license/discrapp/api)

## Introduction

This repository contains Supabase functions, database migrations, and API
configuration for the Discr application.

### Key Features

- Supabase database schema and migrations
- Edge functions for serverless API endpoints
- Database policies and security rules
- CI/CD with GitHub Actions

## Prerequisites

- Supabase CLI
- Node.js 18+ and npm (for edge functions)

## Setup

### Environment Variables

Copy the example environment file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Required environment variables:

- `SUPABASE_PROJECT_REF` - Your Supabase project reference ID
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (keep secure!)
- `DATABASE_URL` - PostgreSQL connection string

Get these values from your Supabase project dashboard at:
<https://app.supabase.com/project/discr-mvp/settings/api>

### Installation

Install the Supabase CLI:

```bash
brew install supabase/tap/supabase
```

Link to your Supabase project:

```bash
supabase login
supabase link --project-ref $SUPABASE_PROJECT_REF
```

## Development

### Database Migrations

Create a new migration:

```bash
supabase migration new migration_name
```

Apply migrations locally:

```bash
supabase db reset
```

Push migrations to production:

```bash
supabase db push
```

### Edge Functions

Create a new edge function:

```bash
supabase functions new function_name
```

Serve functions locally:

```bash
supabase functions serve
```

Deploy functions:

```bash
supabase functions deploy function_name
```

## Project Structure

```text
api/
├── supabase/
│   ├── migrations/     # Database migrations
│   ├── functions/      # Edge functions
│   └── config.toml     # Supabase configuration
├── .github/            # GitHub Actions workflows
└── README.md
```

## Contributing

Upon first clone, install the pre-commit hooks:

```bash
pre-commit install
```

To run pre-commit hooks locally:

```bash
pre-commit run --all-files
```

This project uses conventional commits for version management.
Please ensure your commits follow the format:

```text
type(scope): description

feat: add new feature
fix: resolve bug
docs: update documentation
chore: maintenance tasks
```

## Test Coverage

This project maintains **95.5% line coverage** and **82.4% branch coverage** for
all application code.

### Running Tests

```bash
# Run all tests with coverage report
./scripts/test-coverage.sh

# Run tests only (faster)
cd supabase/functions
deno test --allow-all

# View HTML coverage report
open supabase/functions/.coverage/html/index.html
```

### Coverage Details

- **487 tests** all passing ✅
- **Application code:** 100% coverage (all testable code)
- **Overall:** 95.5% line coverage, 82.4% branch coverage
- **Excluded:** 4.5% third-party integration code (documented in TESTING.md)

**What's excluded and why:**

| File | Reason |
|------|--------|
| `sentry-integration.ts` | Third-party Sentry SDK integration |
| `sentry.ts` (3 lines) | Call sites to excluded integration |
| `logo-data.ts` | Base64-encoded image data |

See [TESTING.md](./TESTING.md) for complete testing guidelines and coverage
exclusion rationale.

## License

See LICENSE file for details.
