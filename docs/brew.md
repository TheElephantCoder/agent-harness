# Brew

Single repo is the tap. `Formula/agent-harness.rb` lives here, so you don't need a separate `homebrew-tap` repo.

## Install

Direct install after tapping: then it's just `brew install agent-harness`:

```bash
brew tap TheElephantCoder/agent-harness
brew install agent-harness

# verify
harness --version
harness doctor

# later
brew upgrade agent-harness
```

One-liner without pre-tapping:

```bash
brew install TheElephantCoder/agent-harness/agent-harness
```

HEAD (latest on main, skips sha check):

```bash
brew install --HEAD TheElephantCoder/agent-harness/agent-harness
```

Local formula (from this checkout, no tap needed):

```bash
brew install --build-from-source Formula/agent-harness.rb
```

## How it works

The formula is `Formula/agent-harness.rb`. It depends on `node`, runs `npm install` with Homebrew's `std_npm_install_args`, and shims `harness` into `bin`. Because the repo itself contains `Formula/`, Homebrew treats `TheElephantCoder/agent-harness` as a tap directly.

Truly tap-less `brew install agent-harness` (no `tap` at all) only works from `homebrew/core`. That requires submitting the formula to https://github.com/Homebrew/homebrew-core via `brew bump-formula-pr`. If you want that, run:

```bash
brew bump-formula-pr --tag=v0.1.0 --version=0.1.0 Formula/agent-harness.rb
```

Otherwise the single-repo tap above is the smallest setup: after the one-time `brew tap`, installs are just `brew install agent-harness`.

If you do prefer the short name (`brew tap TheElephantCoder/tap`), create a separate repo `github.com/TheElephantCoder/homebrew-tap` and copy the formula there. But it's not required.

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

- The python package `agent-harness-cli` is not installed via brew. Use `pipx` if you want it.
- `sha256` must be updated per release. If you forget, `brew install` will fail with a sha mismatch. Run `scripts/bump-brew.sh` again.
- `head` in the formula points to `main`, so `--HEAD` installs main without needing a sha.
