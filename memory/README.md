# Memory

Persistent context so you don't start from zero every session.

## Layout

```
memory/
  MEMORY.md        # curated, always loaded, keep under ~8k tokens
  SOUL.md          # who the agent is
  USER.md          # who you are
  AGENTS.md        # also at repo root for tools that expect it there
  sessions/        # raw logs per session
  decisions/       # short ADRs
  tiers/
    hot.md         # always loaded
    warm.md        # loaded on keyword
    cold/          # explicit read only
```

## MEMORY.md

This is the curated one. Not append only.

```markdown
# Memory

## Project
- what this repo is, stack, structure

## Conventions
- code style, commit style

## Decisions
- short ADRs or links to decisions/

## Gotchas
- things that have bitten us before

## People
- preferences
```

Keep it dense. Run `harness memory prune` now and then.

## SOUL and USER

Short files about the agent and the user. Nothing clever, just helps keep tone consistent.

## Sessions

The exit hook writes `sessions/<date>.md` and `harness memory sync` distills it into `MEMORY.md`.

## How fast

Hot tier loads in tens of ms, warm in a couple hundred. Whole hydration is usually under a couple seconds. See `docs/performance.md` for numbers.
