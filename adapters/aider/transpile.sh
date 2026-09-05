#!/usr/bin/env bash
# transpile skills/instincts/memory to Aider (.aider.conf.yml + CONVENTIONS.md)
# usage: ./transpile.sh <skillSrc> <dest>
# Aider loads .aider.conf.yml at repo root and reads files listed under read:.
# Skills merge into CONVENTIONS.md as sections. Post-edit instinct maps to
# lint-cmd/test-cmd in config. There is no pre-tool hook equivalent.
set -euo pipefail
src="${1:-skills}"
dest="${2:-.}"
# write .aider.conf.yml with read: [CONVENTIONS.md, AGENTS.md, MEMORY.md]
# append each skill as a section in CONVENTIONS.md
# set lint-cmd/test-cmd from post-edit instinct
# this is a placeholder — harness doctor --fix does the actual copy
echo "[aider] transpile $src -> $dest (.aider.conf.yml + CONVENTIONS.md, harness doctor handles the real copy)"
