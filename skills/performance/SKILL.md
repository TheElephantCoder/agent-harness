---
name: performance
description: Keep sessions fast and cheap. Always on.
version: 1.0.0
allowed-tools: [read, grep, glob, bash]
triggers:
  - "optimize"
  - "performance"
  - "slow"
  - "tokens"
metadata:
  category: performance
---

# Performance

Make it fast, keep tokens low.

## How

**Batch things.** If you need to read 3 files, read them in the same turn. Same for greps. Don't do `git status` then `git diff` in two separate calls.

**Grep first, read second.** Never read a big unknown file just to see what's in it. Grep, then read the exact spot.

**Don't load everything.** MEMORY summary first, details on demand. Skills load when triggered, not at boot. That's what `memory/tiers` is for.

**Keep context small.** Summarize long logs instead of pasting 500 lines. Keep `MEMORY.md` under 8k. Prefer surgical `edit` over rewriting a whole file.

**Measure.** Run `harness bench --quick` before and after you try to optimize. Track cold start, tokens, tool calls, hook time.

Targets I try to hold:

- cold start <15s
- tokens per task <50k avg
- tool calls per task <60
- hook p99 <100ms

## Check

```bash
harness bench --task cold-start --harness opencode
harness bench --compare main
```
