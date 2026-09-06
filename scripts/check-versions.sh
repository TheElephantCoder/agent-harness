#!/usr/bin/env bash
# fail if version literals drift between package files
# single source is package.json, everything else must match it
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PKG=$(node -p "require('./package.json').version")
fail=0

check() {
  if ! grep -qF "$2" "$1"; then
    echo "[versions] mismatch in $1, want $2" >&2
    fail=1
  fi
}

check src/harness/cli.ts "VERSION = \"$PKG\""
check src/harness/cli.py "VERSION = \"$PKG\""
check pyproject.toml "version = \"$PKG\""

# index.ts must re-export, never duplicate the literal
if grep -qE 'VERSION = "[0-9]' src/harness/index.ts; then
  echo "[versions] index.ts duplicates VERSION instead of re-exporting" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "[versions] ok ($PKG everywhere)"
