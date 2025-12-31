#!/bin/bash

# Test Coverage Script
#
# This script runs tests with coverage and excludes third-party integration
# files from the coverage report. See TESTING.md for rationale.
#
# Usage:
#   ./scripts/test-coverage.sh

set -e

cd "$(dirname "$0")/.."

echo "🧪 Running tests with coverage..."
cd supabase/functions
rm -rf .coverage
deno test --coverage=.coverage --allow-all --reload

echo ""
echo "📊 Generating coverage report (excluding third-party integrations)..."
deno coverage .coverage \
  --exclude="sentry-integration.ts" \
  --exclude="image-compression.ts"

echo ""
echo "✅ Coverage report complete!"
echo ""
echo "📄 Detailed reports available at:"
echo "   - LCOV: supabase/functions/.coverage/lcov.info"
echo "   - HTML: supabase/functions/.coverage/html/index.html"
echo ""
echo "ℹ️  Note: Excluded from coverage (third-party integrations):"
echo "   - sentry-integration.ts (Sentry SDK)"
echo "   - image-compression.ts (ImageMagick WASM)"
echo "   See TESTING.md for details"
