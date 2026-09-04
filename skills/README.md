# Skills

Reusable skills. Each one is a `SKILL.md` plus optional `scripts/` and `references/`. Follows the agent skills spec so you can share them.

```
skills/
  research-first/    # research and plan before editing
  performance/       # keep it fast
  security-guard/    # basic guardrails
  memory-sync/       # hydrate and distill memory
```

Use them:

```bash
harness skill list
harness skill add harness/research-first
harness skill add vercel-labs/agent-skills --harness claude,opencode
```

Or copy a folder to `.harness/skills/` manually if you prefer.

To make a new one:

```bash
harness skill create my-skill
```

Minimal `SKILL.md`:

```markdown
---
name: my-skill
description: what it does
version: 1.0.0
triggers: ["keyword"]
---

# My skill

Instructions...
```
