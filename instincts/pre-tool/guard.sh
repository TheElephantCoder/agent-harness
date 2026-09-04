#!/usr/bin/env bash
# Pre-tool guard — block injection, enforce allowlists
set -euo pipefail
INPUT=$(cat)
if echo "$INPUT" | grep -qiE "ignore previous instructions|exfiltrate|BEGIN PRIVATE KEY"; then
  echo "[harness:security] Blocked potential prompt injection / secret" >&2
  exit 2
fi
exit 0
