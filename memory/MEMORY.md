# Memory: harness

Long term notes, kept small so it loads fast.

## Project

- agent-harness, performance layer for agents
- TS (node >=20) + python shim, ships on npm and pip as @theelephantcoder/agent-harness
- layout `skills/`, `instincts/`, `memory/`, `security/`, `research/`, `adapters/`, `src/harness/`
- repo `https://github.com/TheElephantCoder/agent-harness`

## Conventions

- TS: prettier + eslint, python: ruff
- commits like `feat:`, `fix:`, `docs:`, `perf:`
- `main` is protected, PRs need CI
- reference code as `file:line`

## Decisions

- ADR-001 research-first hook blocks multi-file edits until `research/plans/` exists
- ADR-002 ship via npm + pip, core logic in TS, python is a shim
- ADR-003 adapters transpile `skills/` and `instincts/` to each tool's config, no duplication
- ADR-004 local only, no telemetry, just markdown and json

## Gotchas

- opencode expects `opencode.json` at root, not `.opencode/`
- claude hooks live in `.claude/settings.json`
- cursor uses `.cursor/rules/*.mdc` with `alwaysApply: true`
- codex uses `.codex/config.toml` but we shim hooks via `.codex/hooks.json`

## Perf targets

cold start <15s, tokens <50k, tool calls <60, hook p99 <100ms

## People

- TheElephantCoder, prefers concise and factual, `file:line` refs, run it don't guess it
