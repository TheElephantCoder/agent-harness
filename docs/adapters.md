# Adapters

One source, every harness. Harness just transpiles `skills/` and `instincts/` to the format each tool expects.

- Claude Code -> `.claude/settings.json` and `.claude/skills/<name>/`
- Opencode -> `opencode.json` and `.opencode/skills/`
- Codex -> `.codex/config.toml` and `.codex/hooks.json`
- Cursor -> `.cursor/rules/*.mdc` and `.cursor/hooks.json`
- generic -> `.harness/` plus `AGENTS.md`

`harness init` copies `skills/*/SKILL.md` to the right place, merges `instincts/*/hook.json` into the right hooks config, and symlinks or copies `AGENTS.md` and `MEMORY.md`.

It's idempotent. Run it again and it updates. `harness init --migrate` tries not to overwrite your edits, `--clean` removes harness stuff.

Check if things drifted:

```bash
harness doctor --fix    # re-transpile and fix sync
harness doctor --strict # fail on drift
```

Adding a new harness: make `adapters/<name>/adapter.json` and a small `transpile.sh`, then `harness adapter add <name>` and update the table in `README.md`.
