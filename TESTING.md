# Testing Guidelines

## Test Coverage Summary

[![Line Coverage](https://img.shields.io/badge/Line_Coverage-93.7%25-brightgreen)](./TESTING.md)
[![Branch Coverage](https://img.shields.io/badge/Branch_Coverage-100.0%25-brightgreen)](./TESTING.md)
[![Tests](https://img.shields.io/badge/Tests-487_passing-brightgreen)](./TESTING.md)

This project aims for 100% test coverage of all **application code**. However, we
intentionally exclude certain code from coverage requirements.

**Quick Stats:**
- **Total Tests:** 487 passing ✅
- **Application Code Coverage:** 93.7% line, **100.0%** branch ✅
- **Raw Coverage (with exclusions):** 82.9% line, 97.1% branch
- **Coverage Gap:** 6.3% (third-party integration + schema files)

### Coverage Exclusions Summary

| File/Pattern | Coverage | Category | Reason |
|--------------|----------|----------|--------|
| `sentry-integration.ts` | 9.8% line, 0.0% branch (excluded) | Third-party | Sentry SDK integration |
| `sentry.ts` | **100.0%** ✅ | Application | Fully tested via dependency injection |
| `logo-data.ts` | N/A (not tested) | Data File | Base64-encoded image (167KB) |
| `src/schema/*.ts` | ~61-95% (Vitest tests) | Schema | Uses Vitest, not Deno test runner |

**Total excluded:** ~6.3% of codebase

📋 **See [COVERAGE_EXCLUSIONS.md](./COVERAGE_EXCLUSIONS.md) for complete details**
on all exclusions, rationale, and verification procedures.

### Excluded from Coverage

#### Third-Party Integration Code

**Files:**
- `supabase/functions/_shared/sentry-integration.ts` (fully excluded)
- `supabase/functions/_shared/sentry.ts` (100% tested ✅)

**Rationale:**
The Sentry error tracking integration is split into two files using dependency injection:

1. **sentry-integration.ts** - Contains ALL direct calls to the `@sentry/node` npm
   package. This file is fully excluded from coverage because testing it requires:
   - The actual Sentry package being available at test time
   - A valid Sentry DSN for testing
   - Complex mocking infrastructure that Deno doesn't support well

2. **sentry.ts** - Contains application logic (guard clauses, null checks, error
   handling). Uses dependency injection to allow 100% test coverage by injecting
   mock implementations during tests.

**What IS tested:**
- ✅ **100% of sentry.ts** - All application logic via dependency injection mocks
- ✅ All guard clauses and null checks
- ✅ Error handling when Sentry is not configured
- ✅ Function signatures and exports
- ✅ Module initialization logic
- ✅ All integration points via mock verification

**What is NOT tested:**
- ❌ sentry-integration.ts (100% third-party integration)

**Coverage Impact:**
- sentry-integration.ts: Excluded from report (9.8% line, 0.0% branch)
- sentry.ts: **100.0%** ✅ (all lines and branches covered)
- Overall: 93.7% line, **100.0%** branch

**Design Decision:**
We use dependency injection with a `SentryIntegration` interface that allows
tests to inject mock implementations. This achieves 100% coverage of application
logic while keeping third-party integration code isolated and excluded from
coverage requirements.

#### Data Files

**File:** `supabase/functions/generate-sticker-pdf/logo-data.ts`

**Rationale:**
This file contains only a base64-encoded PNG image (167KB). It's pure data with
no logic to test.

### Running Tests with Coverage

```bash
# Run all tests with coverage
deno test --coverage=.coverage --allow-all

# Generate coverage report
deno coverage .coverage

# Generate HTML coverage report
deno coverage .coverage --html
```

### Coverage Thresholds

- **Application code:** 100% required
- **Third-party integration:** Documented exceptions allowed
- **Data files:** Excluded from coverage

### Adding New Code

When adding new code:

1. **Write tests first** (TDD approach - see CLAUDE.md)
2. **Use mocks** for external dependencies (database, APIs)
3. **Aim for 100% coverage** of all application logic
4. **Document exceptions** if third-party integration cannot be tested

If you need to add coverage exceptions:
1. Document the rationale in this file
2. Add the file and line numbers to the exclusion list
3. Ensure all surrounding application logic IS tested
