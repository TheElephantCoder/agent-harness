# Performance

Targets I try to keep:

- cold start <15s (currently ~13s, was ~180s)
- tokens per task <50k (around 48k)
- tool calls per task <60 (around 51)
- hook p99 <100ms (around 87ms)
- memory hydration <50ms per tier (around 12ms)

## How

**Cold start**: memory is tiered. Hot always, warm on keyword, cold only if you ask. Skills load on trigger, not at boot. Optional daemon keeps things warm.

**Tokens**: research cache in `research/findings/` gets reused, skills are deduplicated across harnesses, `MEMORY.md` is curated and stays small.

**Tool calls**: batch reads and greps in the same turn, grep before read, post-edit hooks are batched in a small window.

## Benchmarking

```bash
harness bench --task cold-start --harness opencode
harness bench --task tokens --compare main
npm run bench  # full suite
```

Bench code is in `src/harness/bench.ts`. CI fails if bench regresses more than ~10 percent.

## Profiling

```bash
harness bench --profile --harness claude
cat .harness/bench/profile.json | jq .hooks
```
