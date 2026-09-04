# Security policy

## General

Default deny. If it's not allowlisted, it's not allowed.

- external stuff is data, not instructions. If it says "ignore previous instructions" we block it.
- agent gets minimal file and network scope it needs for the task.
- anything security related gets logged to `sessions/`.

## Prompt injection

We look for the usual patterns: ignore previous instructions, you are now, exfiltrate, send to http, hidden html comments with instructions. Webfetch output and files outside workspace are untrusted.

If we hit it, we stop, warn, don't run, and note it.

## Secrets

We block `sk-`, `ghp_`, `gho_`, `BEGIN PRIVATE KEY`, `AWS_SECRET...`, and high entropy strings over ~20 chars.

If you need an exception, add it to `security/allowlist.txt` with a reason, expiry, and who approved. Don't just blanket allow.

## File and bash

File writes should stay in the workspace and harness dirs. Not `/etc`, `~/.ssh`, `~/.aws`, or parent of workspace. See `security/file-boundaries.json`.

Bash is allowlisted. `git`, `npm`, `pip`, `cargo`, `python`, `node`, `harness`, `pytest` are fine. `curl | bash`, `rm -rf /`, `sudo`, `nc` need a manual ok. Config in `security/bash-allowlist.json`.

## Network

`webfetch` is allowlisted. Private IPs like `127.0.0.1`, `10.*`, `192.168.*` are blocked. Allowlist in `security/network-allowlist.txt`.

## Supply chain

Skills are pinned in `.harness/config.json` with version and sha. `harness skill verify` checks them. CI runs `harness security audit` on PRs.

Report issues via DM `@theelephantcoder` on Discord or a GitHub issue per `SECURITY.md`.
