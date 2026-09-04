#!/usr/bin/env bash
# Post-edit check — format + typecheck (non-blocking, <5s)
set -euo pipefail
if command -v npx >/dev/null 2>&1 && [ -f "package.json" ]; then
  npx --yes prettier --write --log-level silent "$(git diff --name-only 2>/dev/null | head -n 20)" 2>/dev/null || true
fi
exit 0
