#!/usr/bin/env bash
# Install harness into target project, works on macOS and Linux
set -euo pipefail

HARNESS_SRC="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-.}"

echo "[harness] Installing from $HARNESS_SRC to $TARGET"

mkdir -p "$TARGET/.harness"
mkdir -p "$TARGET/memory" "$TARGET/research/findings" "$TARGET/research/plans" "$TARGET/research/evidence"

cp -n "$HARNESS_SRC/AGENTS.md" "$TARGET/AGENTS.md" 2>/dev/null || true
cp -n "$HARNESS_SRC/memory/MEMORY.md" "$TARGET/memory/MEMORY.md" 2>/dev/null || true

# hint PATH on Linux where pip puts harness in ~/.local/bin
if [ "$(uname -s)" = "Linux" ]; then
  if ! command -v harness >/dev/null 2>&1; then
    echo "[harness] note: if you installed via pip, add ~/.local/bin to PATH"
    echo "[harness]   export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
fi

echo "[harness] Adapters: run 'harness init --harness claude,opencode,codex,cursor,kiro-cli,kiro-desktop,cline,aider' for full setup"
echo "[harness] Done. Run 'harness doctor' to verify."
