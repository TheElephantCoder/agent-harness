#!/usr/bin/env bash
# transpile skills/instincts to Kiro (Desktop) .kiro/steering
# Kiro reads steering from .kiro/steering/*.md and agent config from .kiro/settings.json
set -euo pipefail
src="${1:-skills}"
dest="${2:-.kiro/steering}"
mkdir -p "$dest"
# placeholder — harness doctor --fix does the real work
# skills become .kiro/steering/<name>.md, hooks go to .kiro/settings.json
echo "[kiro] transpile $src -> $dest"
