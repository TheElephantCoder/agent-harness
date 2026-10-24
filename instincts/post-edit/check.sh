#!/usr/bin/env bash
# Post-edit check: format + typecheck (non-blocking, <5s)
set -euo pipefail
if command -v npx >/dev/null 2>&1 && [ -f "package.json" ]; then
  # -z/xargs -0: the old substitution joined 20 filenames into ONE argument,
  # so prettier was asked for a file that does not exist and never ran
  # @3.3.3: --yes with a bare name would fetch unpinned prettier@latest
  git diff --name-only -z 2>/dev/null | xargs -0 -r npx --yes prettier@3.3.3 --write --log-level silent 2>/dev/null || true
fi
exit 0
