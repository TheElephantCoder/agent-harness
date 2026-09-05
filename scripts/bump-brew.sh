#!/usr/bin/env bash
# bump brew formula version and sha, works on macOS and Linux
set -euo pipefail
VERSION="${1:?usage: bump-brew.sh <version> e.g. 0.1.0}"
FORMULA="Formula/agent-harness.rb"
TARBALL="https://github.com/TheElephantCoder/agent-harness/archive/refs/tags/v${VERSION}.tar.gz"
echo "fetching $TARBALL ..."
SHA=$(curl -L -s "$TARBALL" | shasum -a 256 | awk '{print $1}')
if [ -z "$SHA" ] || [ "$SHA" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
  echo "failed to fetch tarball or got empty sha"
  exit 1
fi
echo "sha256 $SHA"
# portable sed -i (macOS needs '', Linux needs no arg)
if sed --version >/dev/null 2>&1; then
  # GNU sed (Linux)
  sed -i "s|url \".*\"|url \"$TARBALL\"|" "$FORMULA"
  sed -i "s/sha256 \".*\"/sha256 \"$SHA\"/" "$FORMULA"
else
  # BSD sed (macOS)
  sed -i '' "s|url \".*\"|url \"$TARBALL\"|" "$FORMULA"
  sed -i '' "s/sha256 \".*\"/sha256 \"$SHA\"/" "$FORMULA"
fi
echo "updated $FORMULA to v${VERSION}"
grep -E "url|sha256" "$FORMULA"
