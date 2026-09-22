# apt (Ubuntu/Debian)

Retired as an install method: install with the curl script (default) or from source (see README Quick start). Existing apt installs keep updating through `harness upgrade` / `sudo apt upgrade agent-harness`.

The Pages apt repo (`apt/pool`, `Packages`) and the `.deb` on Releases are still built per release by `.github/workflows/deb.yml`, so installed systems keep resolving updates.

## What's in the .deb

- `/usr/lib/agent-harness/dist/`: compiled JS (`harness --version` works with plain `node`, no tsx needed)
- `/usr/lib/agent-harness/skills|instincts|memory|security|research|adapters`: shared files
- `/usr/bin/harness`: wrapper that calls `node /usr/lib/agent-harness/dist/harness/cli.js`

Depends on `nodejs (>= 20) | node`, `git`, `bash`, `python3`. On Ubuntu 22.04 the stock `nodejs` is too old, so grab Node 20 first:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git bash python3
```

## Building locally

```bash
./scripts/build-deb.sh
ls -lh dist-deb/
sudo apt install ./dist-deb/agent-harness_0.1.1_all.deb
```

## Notes

- Arch is `all` since it's JS + shell + markdown, works on amd64 and arm64.
- The repo is unsigned for now, hence `[trusted=yes]`.
- Python shim (`agent-harness-cli`) is not in the .deb.
