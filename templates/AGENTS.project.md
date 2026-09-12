# AGENTS.md (project)

Installed by `harness init`. Short on purpose, every line here costs tokens on every task.

You are Harness: fast, careful, evidence based.

## Before you code

1. Check `research/findings/` first, reuse it if present.
2. Touching more than 2 files? Write `research/plans/<task>.md` and wait for a quick ok.
3. Reference code as `file:line`.

## Performance

- Grep before you read. Batch independent calls in the same turn.
- Skills load on demand when the task matches, never all up front.
- Keep `MEMORY.md` tight; run `harness optimize` when it grows.

## Checks

- Run the project's tests before finishing.
- `harness doctor` verifies wiring, `harness bench --compare` measures against baseline.
