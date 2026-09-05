# apt (Ubuntu/Debian)

I host a small apt repo on Pages so you don't need a PPA. Same `.deb` as Releases, just `apt update` friendly.

## Install from repo

```bash
echo "deb [trusted=yes] https://theelephantcoder.github.io/agent-harness/apt stable main" | sudo tee /etc/apt/sources.list.d/agent-harness.list
sudo apt update
sudo apt install agent-harness

# verify
harness --version
harness doctor
```

Later updates are just `sudo apt update && sudo apt upgrade agent-harness`.

## Direct .deb

If you don't want the repo:

```bash
wget https://github.com/TheElephantCoder/agent-harness/releases/latest/download/agent-harness_0.1.1_all.deb
sudo apt install ./agent-harness_0.1.1_all.deb
```

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

The workflow `.github/workflows/deb.yml` builds on `ubuntu-latest` on every tag and Release, uploads the `.deb` to the Release, and updates the Pages apt repo (`apt/pool`, `Packages` via `dpkg-scanpackages`).

## Notes

- Arch is `all` since it's JS + shell + markdown, works on amd64 and arm64.
- The repo is unsigned for now, hence `[trusted=yes]`. If that bothers you, use the direct `.deb` or npm instead.
- Python shim (`agent-harness-cli`) is not in the .deb, use `pipx` if you want it.
