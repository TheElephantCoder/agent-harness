#!/usr/bin/env bash
# Enforce research-first for >2 file tasks
set -euo pipefail
INPUT=$(cat)
# count staged edits in this session (heuristic)
if [ -d "research/plans" ] && [ "$(ls -1 research/plans 2>/dev/null | wc -l)" -gt 0 ]; then
  exit 0
fi
# Allow single-file trivial edits without plan
# Block heuristic: if Input contains multiple file paths, require plan
FILE_COUNT=$(echo "$INPUT" | grep -oE '"file_path"[^,]*' | wc -l | tr -d ' ')
if [ "$FILE_COUNT" -gt 2 ]; then
  echo "[harness:research-first] Blocked: multi-file edit without research/plans/*.md" >&2
  echo "Create research/findings/<topic>.md + research/plans/<task>.md first. See skills/research-first/SKILL.md" >&2
  exit 2
fi
exit 0
