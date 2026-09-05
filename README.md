# agent-harness

A performance layer for coding agents. Skills, instincts, memory, security, and a research-first workflow that works the same in Claude Code, Codex, Opencode, Cursor, Kiro CLI, Kiro and anything else.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-black)](package.json)

I built this because I was tired of watching agents re-read the same codebase for 3 minutes every new session, re-research the same questions, and then guess at APIs anyway. Harness caches what matters and enforces a research step before code.

Early days. It works for me daily, API might still shift a bit. Issues and small PRs welcome.

## What it does

Four things that actually moved the needle for me:

**Skills**: reusable markdown skills (`SKILL.md` + scripts). Write once, use in every harness. Follows the agent skills spec so you can also pull in other people's skills.

```bash
harness skill add vercel-labs/agent-skills
harness skill add harness/research-first
harness skill list
```

**Instincts**: hooks that fire on their own. Pre-tool checks, post-edit format + typecheck, session start hydration. Muscle memory so the agent does the right thing without you prompting it.

**Memory**: persistent context that survives between sessions. `MEMORY.md` stays under ~8k tokens and loads in a couple seconds. No more 3 minute cold start re-explaining your project.

```
memory/
  MEMORY.md      # long term, always loaded
  SOUL.md        # who the agent is
  USER.md        # who you are
  sessions/      # raw session notes, pruned after a bit
  decisions/     # ADRs when we pick between options
```

On my main repo cold start went from ~180s to about 13s.

**Security**: default deny. Prompt injection checks, secret scanning before commits, bash allowlist, file write boundaries. Nothing fancy, just catches the dumb mistakes before they ship.

**Research first**: the agent has to look things up before it edits. Checks `research/findings/` first, then codebase, then web. Writes a short plan in `research/plans/` and waits for a quick ok. Sounds strict but it cuts rework a lot.

```
research/
  findings/      # one file per topic, cached
  plans/         # short plan per task
  evidence/      # links, repros, citations
```

More detail in [`skills/`](skills/), [`instincts/`](instincts/), [`memory/`](memory/), [`security/`](security/), [`research/`](research/).

## Performance

I measure three things: time to useful, tokens per task, and extra hook latency. Rough numbers on a 250k LOC TS monorepo on an M2 Max:

- cold start 180s -> 13s
- tokens per task down ~65 percent
- tool calls down ~40 percent
- hook overhead p99 under 100ms

Run it yourself:

```bash
harness bench --harness opencode --task cold-start
harness bench --compare
```

Notes and how it works in [`docs/performance.md`](docs/performance.md).

## Works with

You write skills and memory once, harness transpiles to each tool.

- Claude Code -> `.claude/settings.json` + `.claude/skills/`
- Opencode -> `opencode.json`
- Codex -> `.codex/hooks.json`
- Cursor -> `.cursor/rules/*.mdc`
- Kiro CLI -> `.kiro/skills/` + `.kiro/settings.json`
- Kiro (Desktop) -> `.kiro/steering/` + `.kiro/settings.json`
- anything else -> `.harness/` + `AGENTS.md`

```
agent-harness/
  skills/       # shared
  instincts/    # shared
  memory/       # shared
  research/     # shared
  adapters/
    claude/
    opencode/
    codex/
    cursor/
    kiro-cli/
    kiro-desktop/
```

See [`adapters/`](adapters/) for how the transpilation works.

## Quick start

```bash
# npm
npm install -g @theelephantcoder/agent-harness
# or without install
npx @theelephantcoder/agent-harness init

# python if you prefer
pip install agent-harness-cli
pipx install agent-harness-cli

# brew (macOS) — same repo is the tap, no second repo needed
brew tap TheElephantCoder/agent-harness
brew install agent-harness
# now it's just
brew install agent-harness
brew upgrade agent-harness
# without pre-tapping, one-liner
brew install TheElephantCoder/agent-harness/agent-harness
# HEAD (latest on main)
brew install --HEAD TheElephantCoder/agent-harness/agent-harness
# local, from this checkout
brew install --build-from-source Formula/agent-harness.rb

# from source
git clone https://github.com/TheElephantCoder/agent-harness.git
cd agent-harness
npm install
npm link
```

In your project:

```bash
cd your-project
harness init
# picks harnesses interactively, or:
harness init --auto        # tries to detect what you use
harness init --migrate     # add to existing project without overwriting

harness doctor             # check everything wired up
harness bench --quick      # 30s sanity check
```

What `init` creates:

```
your-project/
  .harness/config.json
  AGENTS.md
  memory/...
  .claude/          # if you picked claude
  opencode.json     # if you picked opencode
  .cursor/rules/    # if you picked cursor
```

Day to day:

```bash
harness memory sync              # distill session into MEMORY.md (also runs on exit)
harness skill search "review"    # find a skill
harness research "best way to do X"  # caches findings with citations
harness security audit           # scan for secrets and injection stuff
```

## CLI

```
harness init [--harness <name>] [--auto] [--migrate]
harness doctor [--fix]
harness bench [--harness <name>] [--task <task>] [--compare]
harness skill <add|list|remove|search|info> [name]
harness memory <sync|show|edit|prune>
harness instinct <list|enable|disable> [name]
harness research <query> [--plan]
harness security <audit|scan|fix>
harness upgrade
```

`harness --help` has the rest. Also [`docs/cli.md`](docs/cli.md).

## How it fits together

```
adapter layer:  Claude Code | Codex | Opencode | Cursor | Kiro CLI | Kiro
                ---------------------------------------------------------
harness core:   skills | instincts | memory | security | research
                cache + batch + compress (perf bits)
                ---------------------------------------------------------
your project:   .harness / MEMORY.md / AGENTS.md
```

No lock in. Adapters are just transpilers. Remove harness and your project still works, you just lose the caching and guardrails.

## Research first flow

For anything that touches more than a couple files:

1. research -> check `research/findings/`, grep codebase, web search if needed
2. plan -> write `research/plans/<task>.md` (approach, files, risks)
3. approve -> you give a quick ok (small low risk edits auto approve)
4. build -> implement
5. verify -> tests + `harness bench` + `harness security audit`
6. remember -> `harness memory sync` distills it

`instincts/research-first` blocks multi-file edits until the plan exists. Annoying at first, saves time later.

## Examples

```bash
# new next app with harness from the start
npx create-next-app@latest my-app && cd my-app
npx @theelephantcoder/agent-harness init --auto

# add a skill everywhere at once
harness skill add vercel/nextjs-skill
# now its available in claude, opencode, cursor without copying files around
```

Custom instinct after a TS edit:

```markdown
# instincts/my-check/SKILL.md
---
name: my-check
trigger: post-edit
when: "file =~ \\.ts$"
---
Run `npm run typecheck` after TS edits. Block commit on failure.
```

## Contributing

Small PRs are easiest to review. See [CONTRIBUTING.md](CONTRIBUTING.md).

Good first issues are labeled `skill`, `adapter`, `instinct`.

If you touch perf, include a before/after `harness bench`.

## Security

See [SECURITY.md](SECURITY.md). For vulns DM `@theelephantcoder` on Discord or open a GitHub issue and note it's private.

## License

[MIT](LICENSE) - TheElephantCoder

https://github.com/TheElephantCoder/agent-harness
