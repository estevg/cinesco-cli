#!/usr/bin/env bash
# Fail if the committed dist/ bundles are out of date with src/.
set -euo pipefail
cd "$(dirname "$0")/.."
bun scripts/build.ts >/dev/null
if ! git diff --quiet -- dist; then
  echo "✗ dist/ is stale — run 'bun run build' and commit dist/"
  git --no-pager diff --stat -- dist
  exit 1
fi
echo "✓ dist/ up to date"
