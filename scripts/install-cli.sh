#!/usr/bin/env bash
# agent-harness one-line installer: puts the `harness` CLI on this machine.
# usage:
#   curl -fsSL https://raw.githubusercontent.com/TheElephantCoder/agent-harness/main/scripts/install-cli.sh | bash
#   curl -fsSL ... | HARNESS_REF=v0.2.1 bash   # pin a release tag instead of main
#   HARNESS_PREFIX=$HOME/.local bash scripts/install-cli.sh   # user-local, no sudo
# needs: Node >= 20 with npm. macOS + Linux.
set -euo pipefail

REPO="TheElephantCoder/agent-harness"
REF="${HARNESS_REF:-main}"

say() { printf '[harness] %s\n' "$*"; }
fail() { printf '[harness] FAIL - %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node not found - install Node >= 20 first (https://nodejs.org or: brew install node)"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge 20 ] || fail "node ${NODE_MAJOR} too old - need >= 20"
command -v npm >/dev/null 2>&1 || fail "npm not found alongside node"

# resolve the tarball. main floats, so pin it to a sha exactly like
# `harness upgrade` does (npm serves stale branch tarballs from cache).
# tags are immutable, use them directly.
resolve_sha() {
  node -e "
fetch('https://api.github.com/repos/${REPO}/commits/${REF}', { headers: { 'User-Agent': 'agent-harness-installer', Accept: 'application/vnd.github+json' } })
  .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
  .then((j) => { if (!/^[0-9a-f]{40}$/.test(j.sha)) throw new Error('bad sha'); console.log(j.sha); })
  .catch(() => process.exit(1));
"
}
if [ "$REF" = "main" ]; then
  if SHA="$(resolve_sha 2>/dev/null)"; then
    URL="https://codeload.github.com/${REPO}/tar.gz/${SHA}"
    say "installing ${REPO}@${SHA:0:7} (pinned, beats npm cache staleness)"
  else
    URL="https://codeload.github.com/${REPO}/tar.gz/refs/heads/main"
    say "api unreachable, installing from branch tarball"
  fi
else
  URL="https://codeload.github.com/${REPO}/tar.gz/refs/tags/${REF}"
  say "installing ${REPO}@${REF}"
fi

ARGS=()
if [ -n "${HARNESS_PREFIX:-}" ]; then
  BIN="$HARNESS_PREFIX/bin/harness"
  # stdin is the piped script itself when curl|bash, so keep npm off stdin.
  # (no arrays: macOS ships bash 3.2, where empty arrays trip `set -u`.)
  npm install --prefix="$HARNESS_PREFIX" -g "$URL" < /dev/null || fail "npm install failed"
else
  BIN="harness"
  npm install -g "$URL" < /dev/null || fail "npm install failed"
fi

if [ -n "${HARNESS_PREFIX:-}" ]; then
  [ -x "$BIN" ] || fail "install finished but $BIN missing"
else
  command -v harness >/dev/null 2>&1 || fail "installed but harness not on PATH - add $(npm config get prefix)/bin to PATH"
fi
say "installed: $("$BIN" --version)"
say "next: cd your-project && harness init --auto && harness doctor"
