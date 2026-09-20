---
name: memory-sync
description: Keep memory warm and small. Hydrate at start, append notes at end.
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
  MEMORY.md        # curated, always loaded, keep under 2k
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

**End**: run `harness memory sync "..."` with what you learned (it appends + re-prunes to budget).

## Tips

- `MEMORY.md` is curated, not append only. Keep it under 2k tokens, edit surgically.
- If you considered 2+ approaches and picked one, write a short `decisions/ADR-###.md`.
- No secrets in memory, it gets redacted anyway.

Commands:

```bash
harness memory show
harness memory edit
harness memory prune
harness memory sync "note"
```
