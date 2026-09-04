#!/usr/bin/env bash
# Install harness into target project
set -euo pipefail

HARNESS_SRC="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-.}"

echo "[harness] Installing from $HARNESS_SRC → $TARGET"

mkdir -p "$TARGET/.harness"
mkdir -p "$TARGET/memory" "$TARGET/research/findings" "$TARGET/research/plans" "$TARGET/research/evidence"

cp -n "$HARNESS_SRC/AGENTS.md" "$TARGET/AGENTS.md" 2>/dev/null || true
cp -n "$HARNESS_SRC/memory/MEMORY.md" "$TARGET/memory/MEMORY.md" 2>/dev/null || true

echo "[harness] Adapters: run 'harness init --harness claude,opencode,codex,cursor' for full setup"
echo "[harness] Done. Run 'harness doctor' to verify."
