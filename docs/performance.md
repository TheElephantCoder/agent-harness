# Performance

Targets I try to keep, from my own setup (250k LOC TS monorepo, M2 Max).
Independent A/B numbers on other models and hardware live on the site
Benchmark tab, raw rows in `benchmarks.md`.

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
harness bench --quick     # 1 run per hook, seconds
harness bench             # 3 runs per hook
harness bench --compare   # diff against .harness/bench.json (first run saves it)
npm run bench             # same as harness bench --quick, via the built CLI
```

Bench measures cold start (CLI spawn), each hook script executed and timed, per-skill `~tokens`, and adapter validation. CI runs `bench --quick` and fails on budget misses. Token counts are estimates (~4 chars each).
