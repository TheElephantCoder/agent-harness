#!/usr/bin/env bash
# Hydrate memory at session start — budget <15s
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "[harness:session-start] Hydrating memory..."
cat "$ROOT/memory/MEMORY.md" 2>/dev/null | head -n 200 || echo "[harness] no MEMORY.md yet"
cat "$ROOT/memory/tiers/hot.md" 2>/dev/null | head -n 100 || true
echo "[harness:session-start] done in <2s"
