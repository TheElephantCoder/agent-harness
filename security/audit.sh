#!/usr/bin/env bash
# security/audit.sh — secret scan + policy checks
set -euo pipefail
STAGED=false
if [[ "${1:-}" == "--staged" ]]; then STAGED=true; fi

PATTERN='(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|BEGIN PRIVATE KEY|AWS_SECRET_ACCESS_KEY|AKIA[0-9A-Z]{16})'

if $STAGED; then
  FILES=$(git diff --cached --name-only 2>/dev/null || true)
else
  FILES=$(git ls-files 2>/dev/null || find . -type f -name "*.md" -o -name "*.ts" -o -name "*.py" | head -n 100)
fi

# docs mention example secrets, don't flag them if allowlisted via pattern file
# also skip checking the audit script and policy doc itself for example strings
SKIP="security/audit.sh|security/policy.md|security/README.md|skills/|docs/"

FOUND=false
for f in $FILES; do
  [ -f "$f" ] || continue
  if echo "$f" | grep -Eq "$SKIP" 2>/dev/null; then
    continue
  fi
  if echo "$f" | grep -q "guard.sh" 2>/dev/null; then
    continue
  fi
  if grep -Eq "$PATTERN" "$f" 2>/dev/null; then
    if grep -qF "$f" security/allowlist.txt 2>/dev/null; then
      echo "[audit] allowlisted: $f"
    else
      echo "[audit] found possible secret in $f" >&2
      FOUND=true
    fi
  fi
done

if $FOUND; then
  echo "[audit] blocked — remove secrets or add to security/allowlist.txt with justification" >&2
  exit 1
fi
echo "[audit] ✔ clean"
