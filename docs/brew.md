# Brew

Retired as an install method: install with the curl script (default) or from source (see README Quick start). Existing brew installs keep updating through `harness upgrade` / `brew upgrade agent-harness`.

## How it works

The formula is `Formula/agent-harness.rb`. It depends on `node`, runs `npm install` with Homebrew's `std_npm_install_args`, and shims `harness` into `bin`. Because the repo itself contains `Formula/`, Homebrew treats `TheElephantCoder/agent-harness` as a tap directly.

## Releasing a new version

On each release `vX.Y.Z`:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
# wait for tarball to appear, then bump sha
./scripts/bump-brew.sh 0.1.0
git add Formula/agent-harness.rb
git commit -m "bump brew to v0.1.0"
git push
```

`scripts/bump-brew.sh` fetches `https://github.com/TheElephantCoder/agent-harness/archive/refs/tags/vX.Y.Z.tar.gz` and patches `url` and `sha256` in the formula.

You can also trigger it via GitHub Actions: `Actions -> brew -> Run workflow` with version `0.1.0`, or it runs automatically on `release: published` (see `.github/workflows/brew.yml`). For single-repo it just commits the sha bump to the same repo.

## Notes

- `sha256` must be updated per release. If you forget, `brew install` will fail with a sha mismatch. Run `scripts/bump-brew.sh` again.
- `head` in the formula points to `main`, so `--HEAD` installs main without needing a sha.
