#!/usr/bin/env bash
# build a .deb for Debian/Ubuntu from this repo
# usage: ./scripts/build-deb.sh [version] (defaults to package.json version)
# output: dist-deb/agent-harness_<version>_all.deb
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(python3 -c "import json; print(json.load(open('package.json'))['version'])")}"
ARCH="all"
PKGNAME="agent-harness"
OUTDIR="dist-deb"
STAGE="$OUTDIR/${PKGNAME}_${VERSION}_${ARCH}"

echo "[deb] building $PKGNAME $VERSION for $ARCH"

# need node + npm to compile
if ! command -v node >/dev/null 2>&1; then
  echo "[deb] node not found, need Node >=20 (see https://nodejs.org or NodeSource for Ubuntu)" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[deb] npm not found" >&2
  exit 1
fi

# install deps + compile (uses dev typescript, same as brew)
if [ ! -d node_modules ]; then
  echo "[deb] npm install..."
  npm install --no-audit --no-fund
fi
echo "[deb] npm run build..."
npm run build

# check dist exists
if [ ! -f dist/harness/cli.js ]; then
  echo "[deb] dist/harness/cli.js missing after build" >&2
  exit 1
fi
# quick smoke test with plain node (like brew test does)
node dist/harness/cli.js --version
node dist/harness/cli.js doctor | head -5

rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN"
mkdir -p "$STAGE/usr/lib/agent-harness"
mkdir -p "$STAGE/usr/bin"
mkdir -p "$STAGE/usr/share/doc/agent-harness"

# control file
cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: agent-harness
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: TheElephantCoder
Depends: nodejs (>= 20) | node (>= 20), git, bash, python3
Recommends: pipx
Description: Performance layer for coding agents
 Skills, instincts, memory, security and research-first
 that works across Claude Code, Codex, Opencode, Cursor,
 Kiro CLI and Kiro. No telemetry, just markdown + JSON.
 .
 Install and run harness doctor to verify.
CONTROL

# copy runtime files (no node_modules, no .git)
# dist is the compiled CLI, the rest is markdown + shell
mkdir -p "$STAGE/usr/lib/agent-harness/dist"
cp -r dist/harness "$STAGE/usr/lib/agent-harness/dist/"
cp -r skills instincts memory security research adapters "$STAGE/usr/lib/agent-harness/"
cp AGENTS.md README.md LICENSE "$STAGE/usr/lib/agent-harness/"
cp package.json "$STAGE/usr/lib/agent-harness/"
# python shim for pip users (optional, but keep for parity)
mkdir -p "$STAGE/usr/lib/agent-harness/src/harness"
cp src/harness/cli.py "$STAGE/usr/lib/agent-harness/src/harness/" 2>/dev/null || true

# wrapper in /usr/bin that calls node on the compiled JS
cat > "$STAGE/usr/bin/harness" <<WRAPPER
#!/usr/bin/env bash
# harness wrapper installed by agent-harness .deb
set -euo pipefail
exec /usr/bin/node /usr/lib/agent-harness/dist/harness/cli.js "\$@"
WRAPPER
chmod 755 "$STAGE/usr/bin/harness"
chmod 755 "$STAGE/usr/lib/agent-harness/dist/harness/cli.js" 2>/dev/null || true

# docs
cp README.md "$STAGE/usr/share/doc/agent-harness/"
cp LICENSE "$STAGE/usr/share/doc/agent-harness/copyright" 2>/dev/null || true

# perms
find "$STAGE" -type d -exec chmod 755 {} \;
find "$STAGE/usr/lib/agent-harness" -type f -exec chmod 644 {} \;
chmod 755 "$STAGE/usr/bin/harness"
chmod 755 "$STAGE/usr/lib/agent-harness/security/audit.sh" 2>/dev/null || true
chmod 755 "$STAGE/usr/lib/agent-harness/instincts"/*/**.sh 2>/dev/null || true
find "$STAGE/usr/lib/agent-harness/instincts" -name "*.sh" -exec chmod 755 {} \; 2>/dev/null || true
find "$STAGE/usr/lib/agent-harness/scripts" -name "*.sh" -exec chmod 755 {} \; 2>/dev/null || true

mkdir -p "$OUTDIR"
dpkg-deb --build "$STAGE" "$OUTDIR/${PKGNAME}_${VERSION}_${ARCH}.deb"
echo "[deb] built $OUTDIR/${PKGNAME}_${VERSION}_${ARCH}.deb"
ls -lh "$OUTDIR/${PKGNAME}_${VERSION}_${ARCH}.deb"
# quick lint if available
if command -v lintian >/dev/null 2>&1; then
  lintian "$OUTDIR/${PKGNAME}_${VERSION}_${ARCH}.deb" || true
fi
