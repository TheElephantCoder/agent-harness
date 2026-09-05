#!/usr/bin/env bash
# transpile skills/instincts/memory to Cline (.clinerules/ + AGENTS.md)
# usage: ./transpile.sh <skillSrc> <dest>
# Cline reads .md files in .clinerules/ as workspace rules and AGENTS.md at root natively.
# It has no hooks system, so instincts become 00-harness-instincts.md, an always-on rule.
set -euo pipefail
src="${1:-skills}"
dest="${2:-.clinerules}"
mkdir -p "$dest"
# skills become .clinerules/<name>.md, one concern per file
# instincts merge into .clinerules/00-harness-instincts.md
# AGENTS.md stays at root (Cline picks it up natively), MEMORY.md is referenced from it
# this is a placeholder — harness doctor --fix does the actual copy
echo "[cline] transpile $src -> $dest (harness doctor handles the real copy)"
