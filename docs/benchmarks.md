# A/B benchmark evidence

36 runs: 2 models x 3 tasks x 2 arms x 3 reps. Driver `opencode run --format json`.
Hardware: Apple M4 Mac mini with 16 GB memory (not overclocked).
Raw rows: `research/evidence/ab-results.jsonl` (committed alongside this doc).
Working notes live in `research/` (gitignored session scratch).

Bed: scratch TS repo `wordbox` (fixed commit). T1 orientation Q (keyword grader),
T2 add `--json` flag (test suite + behavior grader), T3 emoji counting fix
(hidden check + tests). Arms: `bare` vs `harness` (init + curated MEMORY.md).
Same prompt both arms, fresh worktree per cell.

## Driver probing (20 models, Nvidia provider)

Live: `moonshotai/kimi-k3`, `nvidia/nemotron-3-super-120b-a12b`.
EOL (410): qwen3-coder-480b, deepseek-v4-flash, deepseek-v4-pro, qwen2.5-coder-32b,
qwen3.5-122b, qwen3-next-80b, llama-3.3-70b, llama-4-maverick, mistral-large-3-675b,
seed-oss-36b, nemotron-super-49b, gpt-oss-120b, minimax-m3, glm-5.2, phi-4-mini.
Not deployed (404): nemotron-ultra-253b. Other error: magistral-small.
Hung, skipped: gemma-4-31b. Not logged in, unusable: Claude Code.

## Results (wall mean [range] s, tokens mean [range], tools mean, pass)

kimi-k3 (free tier, $0 total):

- T1 bare: 261 [213-307], 37530 [32127-40565], 5.7, 3/3
- T1 harness: 256 [181-331], 50708 [43752-54216], 7.0, 3/3
- T2 bare: 280 [249-339], 41835 [33746-49636], 7.3, 3/3
- T2 harness: 234 [168-268], 46569 [43088-53180], 6.3, 3/3
- T3 bare: 207 [179-232], 45986 [40627-49863], 6.3, 3/3
- T3 harness: 255 [181-302], 57584 [45081-75761], 7.7, 3/3

nemotron-3-super-120b ($0.43 total):

- T1 bare: 139 [21-362], 69817 [62770-74062], 8.0, 2/3
- T1 harness: 34 [23-42], 63713 [54440-78695], 7.7, 0/3
- T2 bare: 66 [58-74], 113059 [87466-131925], 14.3, 3/3
- T2 harness: 68 [45-97], 134254 [101298-154740], 15.7, 3/3
- T3 bare: 119 [43-258], 183193 [96578-317906], 21.7, 3/3
- T3 harness: 53 [42-64], 97190 [90738-104584], 11.3, 3/3

## Run 2: slim init payload (same bed, both models)

After run 1, `init` ships a slim AGENTS.md (724B vs 1948B). First-step
measurement showed the direct payload costs only ~740 input tokens; the rest
of historical deltas is trajectory compounding. A kept-events probe of
T1/harness/kimi showed zero web search: 6 steps, inputs growing 7313 to 9221,
i.e. thoroughness behavior (extra exploration resending history), not payload.

kimi-k3 (free tier, $0):

- T1 bare: 539 [527-549], 34787 [30866-39691], 5.3, 3/3
- T1 harness: 573 [475-675], 49168 [41954-62201], 6.3, 3/3
- T2 bare: 499 [439-564], 44172 [41273-49113], 7.3, 3/3
- T2 harness: 496 [447-555], 45424 [41360-50858], 7.0, 3/3
- T3 bare: 450 [410-502], 45479 [40535-48649], 7.3, 3/3
- T3 harness: 466 [415-519], 48419 [42847-52345], 7.3, 3/3

nemotron-3-super-120b:

- T1 bare: 26 [24-28], 68873 [64100-77411], 8.3, 1/3
- T1 harness: 20 [14-28], 65364 [56174-78516], 8.3, 2/3
- T2 bare: 85 [61-120], 143352 [106958-207905], 17.0, 3/3
- T2 harness: 81 [60-113], 115663 [103361-126309], 13.3, 3/3
- T3 bare: 75 [30-99], 124790 [89270-193722], 12.7, 3/3
- T3 harness: 37 [14-65], 86186 [51501-110465], 10.0, 2/3 (one 14s fast fail)

Run-2 scorecard on tokens: 3 nemotron wins, 2 kimi ties (+3%, +6%),
1 kimi loss (T1 +41%, thoroughness behavior above). Raw run-2 rows:
`research/evidence/ab-results-run2.jsonl` (36 cells; one kimi T1-bare cell
retried after a provider-side stall killed the first attempt, kept row used).

## Run 3: nemotron with semantic T1 grader (v2)

T1's keyword grader was failing terse-but-correct answers, so v2 accepts
equivalent phrasings (pre-registered in `research/evidence/ab/grade.sh`,
fixture-tested 7/7 before running, one mid-pre-reg fix committed separately).
Full fresh 18-cell nemotron rerun under v2. T2/T3 graders unchanged.
Raw rows: `research/evidence/ab-results-run3.jsonl`.

nemotron-3-super-120b:

- T1 bare: 49 [34-59], 69113 [65245-76630], 8.3, 2/3
- T1 harness: 61 [50-78], 88054 [56586-129215], 10.3, 1/3
- T2 bare: 71 [35-110], 115029 [76063-134900], 14.0, 3/3
- T2 harness: 70 [44-108], 121612 [87598-181201], 14.3, 3/3
- T3 bare: 67 [39-89], 117318 [100920-141209], 13.7, 3/3
- T3 harness: 72 [51-112], 94861 [83732-109022], 11.7, 3/3

15/18. The three T1 misses are genuinely thin answers (missing files or
facts even under loose matching), split across both arms. Rerunning failures
until they pass would be cherry-picking, so 18/18 stands unreached and the
failures stay published.

## Run 4: nemotron with v3 T1 wording (16/18)

T1 gained one line ("name both implementation files and quote the exact
full output"). Full fresh 18-cell rerun, both arms. Token deltas all fell
inside noise (+8%, -6%, +9%). T1 still misses once per arm: the model answers
thinly ~1/3 of the time no matter the arm, grader, or wording, across three
datasets now. Raw rows: `research/evidence/ab-results-run4.jsonl`.

nemotron-3-super-120b ($0.38):

- T1 bare: 35 [24-41], 72886 [68098-75544], 8.7, 2/3
- T1 harness: 58 [32-82], 78547 [56577-92996], 9.3, 2/3
- T2 bare: 95 [56-134], 121468 [88579-150372], 14.0, 3/3
- T2 harness: 74 [42-115], 113762 [91025-134609], 13.3, 3/3
- T3 bare: 55 [46-66], 94967 [74839-134706], 11.3, 3/3
- T3 harness: 74 [53-92], 103457 [88768-132275], 13.0, 3/3

## New models probed (30 total, 6 live)

Second sweep, Nvidia free tier, sequential with pauses, no 429s hit:
live: mistral-nemotron, muse-glimmer-30b, nemotron-3.5-lightning-30b,
laguna-xs-2.1 (plus kimi-k3 and nemotron-3-super from before).
410 EOL: ministral-14b, mistral-small-4, mistral-medium-3.5, llama-3.1-70b,
nemotron-3-nano-30b, nemotron-mini-4b, qwen3.5-397b, step-3.7-flash, inkling,
solar-10.7b, minimax-m2.7, dracarys-70b, sarvam-m. Hung, skipped: gpt-oss-20b.

Agentic smoke (T1 bare, 1 run each): mistral-nemotron produced zero tool
calls in 227s (can't drive); lightning-30b and laguna-xs acted but missed
(11 and 9 tools); muse-glimmer-30b passed with 15 tools and earned a full
matrix below. Raw rows: `research/evidence/ab-smoke.jsonl`.

## muse-glimmer-30b full matrix (17/18, $0)

- T1 bare: 154 [131-194], 53471 [38996-64564], 3/3
- T1 harness: 157 [145-164], 68855 [43856-90270], 3/3
- T2 bare: 352 [301-416], 97115 [89945-108823], 3/3
- T2 harness: 183 [6-326], 57569 [6406-106087], 2/3 (one 6s no-tool flake)
- T3 bare: 222 [210-235], 92704 [87911-96343], 3/3
- T3 harness: 260 [182-306], 105549 [57754-145160], 3/3

Tokens: T1 +29% harness, T2 -41% (flake-aided), T3 +14%. Raw rows:
`research/evidence/ab-results-glimmer.jsonl`. No model has yet gone 18/18
with a sub-noise token delta on every cell; kimi-k3 is the only 18/18 driver
(twice), nemotron tops out at 16/18 across three datasets.

## Megabox bed (200 files, generator committed)

`scripts/ab-megabox-gen.mjs` (seeded) builds a TS monorepo with a real
order-pricing flow and a green suite. Same rig: kimi-k3, 3 tasks, bare vs
harness+curated-memory, fresh worktree per cell.
Raw rows: `research/evidence/ab-results-mega1.jsonl`.

kimi-k3 (free tier, $0):

- T1 bare: 0/3, wall 647 [561-780], tok 69535
- T1 harness: 0/3, wall 539 [420-664], tok 57182
- T2 bare: 2/3 (one 780s cap-kill), wall 671, tok 57399
- T2 harness: 3/3, wall 549 [369-767], tok 49310
- T3 bare: 3/3, wall 523 [467-561], tok 38966
- T3 harness: 3/3, wall 573 [559-584], tok 33975

T1 sits below this driver's measurement threshold (one diagnostic run
produced a near-perfect answer, so the task is fair but hard: ~1/8 solves).
T2/T3: harness -18%/-14% wall/tokens (T2), -13% tokens (T3), equal or better
success. First consistent pro-harness token signal, modest, both arms
throttled (free-tier queueing visible throughout).

## Mega bed with map treatment, nemotron (12/18)

Same bed, treatment adds the new deterministic repo index (206 files to a
229-line MAP.md, byte-identical across runs) plus richer memory and a narrowed
research trigger. Kimi cells were abandoned after provider throttling killed
3 straight runs at the cap (rows kept out of analysis, disclosed here).

nemotron-3-super-120b ($0.56):

- T1 bare: 0/3, wall 39 [29-56], tok 107295
- T1 harness: 0/3, wall 62 [48-83], tok 117571
- T2 bare: 3/3, wall 119 [75-147], tok 192958, tools 23.0
- T2 harness: 3/3, wall 130 [81-212], tok 264719, tools 33.3
- T3 bare: 3/3, wall 56 [43-73], tok 87186, tools 9.0
- T3 harness: 3/3, wall 58 [37-97], tok 98234, tools 10.3

The map did not move the needle: harness costs MORE tokens in every
measurable cell here (+10%, +37%, +13%). Extra context (map + memory) plus
extra exploration steps outweighs the orientation it saves, on this bed,
with this driver. Raw rows: `research/evidence/ab-results-mega-nemotron.jsonl`.

## Model-independent ratios (deterministic, no LLM involved)

These hold regardless of model because they are file arithmetic and measured
micro-costs, not behavior:

- Orientation compression (megabox bed): 204 source files, 148,267 bytes
  (~37.1k tokens) exhaustive-read ceiling vs `.harness/MAP.md` at 228 lines,
  10,979 bytes (~2.7k tokens). **13.5x.** Framing: locating _where_ things
  live costs one index read instead of up to a full read-through. Comprehension
  still costs reading the files themselves.
- Memory prune scaling (`optimize`, budget 2k tokens, overflow archived,
  nothing deleted): 5.3k -> 1.9k (2.8x), 7.2k -> 2.0k (3.6x),
  21.9k -> 2.0k (11x). Under-budget files untouched (1.8k fixture: no-op).
- Hook fast-paths (550 timed executions): guard ~5ms, hydrate ~7ms,
  enforce p99 45.7ms, post-edit check ~300ms in JS repos (npx startup).
  Policy checks that cost milliseconds, not model calls.

## Mega bed with map treatment, nemotron, second run (11/18, $0.56)

Treatment adds enriched memory and narrowed skill triggers on top of the
map. Raw rows: `research/evidence/ab-results-mega-nemotron-enriched.jsonl`
(a prior 12/18 run under map-only treatment lives in
`research/evidence/ab-results-mega-nemotron.jsonl`; the two runs differ
only in memory/trigger content, same bed, same driver).

nemotron-3-super-120b:

- T1 bare: 0/3, wall 63 [47-81], tok 147598
- T1 harness: 0/3, wall 106 [83-151], tok 138348
- T2 bare: 2/3, wall 130 [55-264], tok 142248, tools 15.3
- T2 harness: 3/3, wall 122 [65-173], tok 178366, tools 19.7
- T3 bare: 3/3, wall 71 [50-95], tok 90754, tools 9.7
- T3 harness: 3/3, wall 107 [62-135], tok 139623, tools 16.0

One honest bright spot inside it: harness went 3/3 on T2 where bare went
2/3. Robustness, not efficiency, and n=1 either way.

## Verdict vs published claims (180s to 13s, -65% tokens, -40% calls)

Not reproduced. Wall time: tied within variance in 4 of 6 cells; one cell each
way outside it (T3/nemotron -55% for harness, T3/kimi +23% against).
Tokens: harness arm used MORE in 5 of 6 cells (+11% to +35%); one cell -47%
(T3/nemotron). Tool calls: similar or higher in 5 of 6; one cell lower
(T3/nemotron, 11.3 vs 21.7). T1/nemotron-harness went 0/3 on the keyword grader
(fast terse answers missed exact strings; grader brittleness, same grader both arms).

Reading: on a small repo the harness context (~5-10k input tokens of
AGENTS.md/MEMORY.md/skills) costs more than orientation saves. It should pay off
where repo-orientation cost dwarfs harness-context cost (large unfamiliar
codebases), which this bed does not test. n=3, free-tier queueing noise visible
(362s outlier). Success parity except the T1/nemotron-harness cell.

Community results land on the site Benchmark tab via the benchmark issue template.
