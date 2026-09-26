# Performance

Targets I try to keep, from my own setup (250k LOC TS monorepo, M2 Max).
Independent A/B numbers on other models and hardware live on the site
Benchmark tab, raw rows in `benchmarks.md`.

Verified regardless of model (deterministic, in `benchmarks.md` under
"Model-independent ratios"): `optimize` shrinks overgrown memory 3-11x to
budget, the repo index compresses orientation 13.5x vs reading everything,
policy hooks run in milliseconds.

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

## Local-model RAM (Ollama)

Measured on Apple M4 Mac mini, 16 GB: inference RAM is weights plus KV
cache, set by model and context window, never by prompt content. Across
30 A/B generations (3 models, bare full-file context vs harness curated
context, fixed `num_ctx` 4096, raw rows in
`research/evidence/ram-cpu-2026-09-23.jsonl`), peak RSS was identical
between arms to 0.1%: 1.2GB (qwen2.5-coder:1.5b), 2.7GB (llama3.2:1b),
4.5GB (starcoder2:3b). Prefill cost per token was identical too
(0.2/0.3/0.6ms); wall-time gaps came from answer length (decode runs
12-22ms/token), not from the harness.

What actually moves RAM, measured:

- Unload idle runners. Switching models leaves every runner resident
  (two models held 4.7GB here). `harness optimize` unloads ollama-managed
  runners (server untouched, next inference reloads transparently);
  `harness doctor` reports residents and warns past one. Measured:
  2 runners, ~2.6GB freed in one command. `keepalive: 0` per request
  does not unload; killing runners is safe and verified.
- Smaller quant. `qwen2.5-coder:1.5b-instruct-q3_K_M` (824MB) vs Q4
  (986MB): resident 954MB vs 1120MB (~15% less), coherent output on a
  code probe, slightly slower wall (3.0s vs 2.2s). Your call on the
  quality tradeoff; doctor does not push it.
- Right-sized context. Per-request `num_ctx` below the server default
  barely moves RSS (server preallocates): 4096 to 1024 saved ~84MB on
  the 1.5B model. To shrink KV for real, set it where the runner is
  born: a Modelfile `PARAMETER num_ctx 2048` on a lean model copy.

Harness overhead itself: hooks peak ~2.3MB (plain bash, 0.00s CPU),
a CLI cold start peaks ~48MB transient. Against GB-scale inference
that is rounding error, and the layer never claimed otherwise.

## Session CPU (multi-step tasks, local models)

Same rig, scripted agent sessions (reasoning steps are inferences, file
reads are free tools). Raw rows in
`research/evidence/ram-cpu-2026-09-23.jsonl` (E3/E4/E5).

- Read-everything baseline vs harness (MAP + memory): harness halves
  session CPU, 49-51% on both models and both bed sizes (12 and 24
  files), reps within 2%. Mechanism is structural: 4 reasoning calls
  vs 2, and ~4x fewer input tokens per session. Decode dominates, so
  the ratio tracks turn count more than anything.
- Grep-disciplined baseline vs harness (same task, real grep output in
  context): dead heat, within 1-3% on both models. When grep answers
  the search question, the index adds nothing measurable. That control
  also validates the rig: equal contexts, equal CPU.
- Capability boundary, not just speed: at 24 files the 1B model fails
  read-everything outright (0/2, confabulates the file list) while
  completing with harness or grep guidance (4/4). Past a model's
  working capacity the comparison isn't 50% — it's completes vs not.

No 60% claim: the measured range is 0-51% depending on baseline
discipline, and the mechanisms already shipped explain all of it, so
no product change came out of this. Claim "halves session CPU on
multi-file search tasks", not more.

## Map index budget

`harness map` caps file rows at 200 (~3k tokens) with a trailer
pointing at grep; the directory layout stays complete. Without the
cap a monorepo writes a 25k-token MAP and the index stops being an
index. Symlinked dirs/files are skipped (a cycle used to recurse).
`init` and `map` report omitted counts.

## Local inference tuning (measured, M4)

Thread count does nothing: `num_thread` 0/2/4/6/8/10 decode within
12.6-13.4ms/token on qwen2.5-coder:1.5b. Inference is Metal-bound,
so CPU knobs don't move it. What matters is total tokens, which is
why the session structure above dominates.

Under CPU saturation (8x `yes` alongside): session CPU rises ~15% in
absolute terms for both arms, ratio unchanged (50.1% clean vs 50.3%
loaded, raw rows `ram-cpu-2026-09-24.jsonl` MINI2). The advantage is
structural (less total compute), not situational.
