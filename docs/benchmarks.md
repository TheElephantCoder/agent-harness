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
