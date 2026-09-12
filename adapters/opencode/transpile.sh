#!/usr/bin/env bash
# install this adapter's files into the current project.
# delegates to harness init so there is one real implementation.
set -euo pipefail
if ! command -v harness >/dev/null 2>&1; then
  echo "[opencode] harness not found - install it first:" >&2
  echo "  npm install -g https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/refs/heads/main" >&2
  exit 1
fi
exec harness init --harness opencode --migrate
