#!/usr/bin/env bash
# transpile skills/instincts to Kiro CLI (.kiro/)
# usage: ./transpile.sh <skillSrc> <dest>
set -euo pipefail
src="${1:-skills}"
dest="${2:-.kiro/skills}"
mkdir -p "$dest"
# copy SKILL.md to .kiro/skills/<name>.md and instincts to .kiro/settings.json hooks
# this is a placeholder — harness doctor --fix does the actual copy
# for Kiro CLI, skills become .kiro/skills/*.md and hooks go to .kiro/settings.json:hooks
echo "[kiro-cli] transpile $src -> $dest (harness doctor handles the real copy)"
