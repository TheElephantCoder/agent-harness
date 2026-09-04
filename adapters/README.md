# Adapters

One source for `skills/` and `instincts/`, transpiled to each harness.

```
adapters/
  claude/     -> .claude/settings.json + .claude/skills/
  codex/      -> .codex/hooks.json
  opencode/   -> opencode.json
  cursor/     -> .cursor/rules/*.mdc
  generic/    -> AGENTS.md + .harness/
```

`harness init --harness <name>` does the copying and conversion. `harness doctor` checks they are still in sync.

To add a new harness, create `adapters/<name>/adapter.json`:

```json
{
  "name": "my-harness",
  "skillPath": ".my-harness/skills",
  "hookPath": ".my-harness/hooks.json",
  "memoryPath": ".my-harness/MEMORY.md",
  "transpile": "scripts/transpile-my-harness.sh"
}
```

Then `harness adapter add <name>`.
