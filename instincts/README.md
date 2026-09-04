# Instincts

Hooks that run on their own. No prompting needed.

Think of them as muscle memory for the agent.

| Instinct | When | What it does |
|---|---|---|
| `session-start` | session starts | loads `MEMORY.md` + hot tier |
| `session-end` | session ends | distills notes into `MEMORY.md` |
| `pre-tool` | before bash/edit/write | checks allowlists and injection |
| `post-edit` | after edit/write | format + typecheck |
| `pre-commit` | git commit | secret scan + quick test gate |
| `research-first` | before multi-file edit | blocks until plan exists |

Each one is a `hook.json` and a shell script:

```
instincts/
  session-start/
    hook.json
    hydrate.sh
  pre-tool/
    hook.json
    guard.sh
```

`harness init` translates those `hook.json` files to whatever your harness needs:

- Claude Code -> `.claude/settings.json`
- Opencode -> `opencode.json`
- Codex -> `.codex/hooks.json`
- Cursor -> `.cursor/hooks.json`

You just edit `instincts/` and run `harness doctor --fix`.

Make a new one:

```bash
harness instinct create my-instinct --event post-edit
```

Example `hook.json`:

```json
{
  "event": "PostToolUse",
  "matcher": "Edit|Write",
  "command": "./instincts/post-edit/check.sh",
  "timeout": 5000,
  "blocking": false
}
```

Try to keep hooks fast. I track overhead with `harness bench --task hooks`. Aim for p99 under 100ms, blocking ones under 500ms or they feel laggy.
