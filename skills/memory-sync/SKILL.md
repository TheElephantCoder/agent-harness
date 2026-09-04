---
name: memory-sync
description: Keep memory warm and small. Hydrate at start, distill at end.
version: 1.0.0
allowed-tools: [read, write, edit, bash, grep]
triggers:
  - "memory"
  - "remember"
  - "context"
metadata:
  category: memory
---

# Memory sync

Keeps sessions from starting cold.

## Layout

```
memory/
  MEMORY.md        # curated, always loaded, keep under 8k
  SOUL.md          # who the agent is
  USER.md          # who you are
  sessions/        # raw per-session notes, cleaned up after ~30d
  decisions/       # short ADRs
  tiers/
    hot.md         # always loaded
    warm.md        # loaded on keyword
    cold/          # explicit read only
```

## Lifecycle

**Start**: read `MEMORY.md` and `tiers/hot.md`. Maybe `warm.md` if the task matches. Don't read `sessions/` unless you're digging into history. Should be under 15s total.

**End**: run `harness memory sync` or let the exit hook do it. It distills the session log into `MEMORY.md`, prunes old stuff, and adds an ADR if you made a real decision.

## Tips

- `MEMORY.md` is curated, not append only. Keep it under 8k tokens, edit surgically.
- If you considered 2+ approaches and picked one, write a short `decisions/ADR-###.md`.
- No secrets in memory, it gets redacted anyway.

Commands:

```bash
harness memory show
harness memory edit
harness memory prune --dry-run
harness memory sync --auto
```
