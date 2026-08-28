#!/usr/bin/env bash
# Compile native binaries for every target the CLIs ship on GitHub Releases.
# Builds both bins: `cinesco` (umbrella: Royal Films + Cine Colombia + Cinemark)
# and `royalfilms` (Royal Films only). Requires Bun. Outputs to dist/.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p binaries

# bin-name : entry file
bins=(
  "cinesco:src/presentation/cinesco.ts"
  "royalfilms:src/presentation/cli.ts"
)

targets=(
  "bun-darwin-arm64:macos-arm64"
  "bun-darwin-x64:macos-x64"
  "bun-linux-x64:linux-x64"
  "bun-linux-arm64:linux-arm64"
  "bun-windows-x64:windows-x64.exe"
)

for b in "${bins[@]}"; do
  name="${b%%:*}"
  entry="${b##*:}"
  for t in "${targets[@]}"; do
    target="${t%%:*}"
    suffix="${t##*:}"
    out="${name}-${suffix}"
    echo "→ $name · $target → binaries/$out"
    bun build "$entry" --compile --minify --target="$target" --outfile "binaries/$out"
  done
done

echo "done. binaries in binaries/:"
ls -lh binaries/
