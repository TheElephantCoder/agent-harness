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
