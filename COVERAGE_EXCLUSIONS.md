# Test Coverage Exclusions Reference

This document provides a comprehensive list of all code excluded from test
coverage requirements and the rationale for each exclusion.

**Last Updated:** 2025-12-26

## Summary

- **Total Exclusions:** 3 files / ~4.5% of codebase
- **Application Code Coverage:** 95.5% (100% of testable code)
- **Raw Coverage:** 82.8% (including exclusions)

## Excluded Files

### 1. `supabase/functions/_shared/sentry-integration.ts`

**Lines:** All (100% excluded)
**Coverage:** 29.2% (intentionally untested)
**Category:** Third-Party Integration

**Rationale:**
This file contains ONLY direct integration with the `@sentry/node` npm package.
Testing this code would require:

1. The actual Sentry npm package available at test time
2. A valid Sentry DSN for testing
3. Complex mocking infrastructure that Deno doesn't support well
4. Testing third-party library behavior (not our application logic)

**What's in this file:**
- Dynamic import of `npm:@sentry/node`
- Calls to `Sentry.init()` with configuration
- Calls to `Sentry.captureException()` and `Sentry.withScope()`
- Calls to `Sentry.setUser()`

**Design Decision:**
We intentionally separated ALL third-party Sentry integration into this
dedicated file to make the exclusion explicit and minimize impact on overall
coverage metrics.

**How it's excluded:**
```bash
deno coverage .coverage --exclude="sentry-integration.ts"
```

---

### 2. `supabase/functions/_shared/sentry.ts`

**Lines:** 44, 58, 70 (3 lines)
**Coverage:** 83.9%
**Category:** Call Sites to Third-Party Integration

**Rationale:**
This file contains application logic (guard clauses, null checks, error
handling). The ONLY uncovered lines are the call sites to functions in
`sentry-integration.ts`. These lines cannot be covered without the integration
file being testable.

**Uncovered lines:**
```typescript
44:   await initSentrySDK();           // Call to integration
58:   sendToSentry(error, context);    // Call to integration
70:   setSentryUser(userId);           // Call to integration
```

**What IS tested (100% coverage):**
- All guard clauses (`if (!SENTRY_DSN)`)
- All null checks (`if (!isSentryConfigured())`)
- Error handling when Sentry is not configured
- Function signatures and exports
- Module initialization logic

**Why these lines can't be tested:**
To cover these call sites, we would need to:
1. Set a valid `SENTRY_DSN` environment variable
2. Successfully import the `@sentry/node` package
3. Have the integration functions actually execute

This is the same problem as testing `sentry-integration.ts` itself.

---

### 3. `supabase/functions/generate-sticker-pdf/logo-data.ts`

**Lines:** All (not included in test runs)
**Coverage:** N/A (not tested)
**Category:** Data File

**Rationale:**
This file contains ONLY a base64-encoded PNG image (167KB). There is no
application logic to test.

**What's in this file:**
```typescript
export const LOGO_BASE64 = `
iVBORw0KGgoAAAANSUhEUgAABkQAAALVCAYAAACRA40+AAAACXBI...
[167KB of base64 data]
`;
```

**Why it's excluded:**
- Pure data, no logic
- No functions or control flow to test
- Would only test that a string constant exists

---

## Coverage Commands

### Run tests with exclusions applied

```bash
./scripts/test-coverage.sh
```

This script:
1. Runs all tests with coverage
2. Generates initial coverage report (82.8%)
3. Generates filtered report excluding `sentry-integration.ts` (95.5%)
4. Displays both reports for transparency

### Run tests without exclusions (raw coverage)

```bash
cd supabase/functions
deno test --coverage=.coverage --allow-all
deno coverage .coverage
```

Shows 82.8% coverage (includes all files).

### View detailed HTML report

```bash
open supabase/functions/.coverage/html/index.html
```

---

## Adding New Exclusions

If you need to exclude additional code from coverage:

1. **Document the rationale** - Add to this file with:
   - File path and line numbers
   - Current coverage percentage
   - Category (third-party, data, etc.)
   - Detailed rationale
   - What IS tested vs. what's excluded
   - Design decisions made

2. **Update TESTING.md** - Add to the summary table

3. **Update coverage script** - Add to `scripts/test-coverage.sh` if needed

4. **Update README badges** - Update coverage percentages if significant

5. **Ensure surrounding code IS tested** - Exclusions should be minimal and
   isolated

---

## Verification

To verify all exclusions are still accurate:

```bash
# Get detailed coverage for excluded files
cd supabase/functions
deno coverage .coverage --detailed | grep -E "sentry|logo-data"
```

Should show:
- `sentry-integration.ts`: ~29% (all third-party integration)
- `sentry.ts`: ~84% (only call sites uncovered)
- `logo-data.ts`: Not in coverage report (not tested)

---

## Philosophy

**We exclude code from coverage when:**

1. **Third-party integration** - Testing requires external packages/services
2. **Pure data** - No logic to test (constants, static data)
3. **Infrastructure** - Code that manages test infrastructure itself

**We DO NOT exclude code when:**

1. **It's difficult to test** - Difficult ≠ impossible
2. **It's rarely used** - All code paths should be tested
3. **It's legacy code** - Refactor or test it
4. **Time constraints** - Technical debt is documented, not hidden

**Principle:** Exclusions must be justified and documented. When in doubt, write
the test.

---

## See Also

- [TESTING.md](./TESTING.md) - Complete testing guidelines
- [README.md](./README.md#test-coverage) - Coverage overview
- [CLAUDE.md](./CLAUDE.md) - Project patterns and TDD requirements
