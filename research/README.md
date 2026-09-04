# Research

Research before code. Saves a lot of rework.

```
research/
  findings/      # one file per topic, cached
  plans/         # plan per task, short
  evidence/      # links, repros, bench notes
```

Flow is simple:

1. check if `findings/` already covers it. If so, reuse.
2. grep codebase, then web search if needed. Use 2026 when searching docs so you don't get old stuff.
3. write `findings/<topic>.md` with sources and what you actually saw in code.
4. write `plans/<task>.md` with approach, files, tests, risks, alternatives you considered.
5. get a quick ok, then code.
6. after, update findings with what actually worked.

For multi-file work the research-first hook will block edits until a plan exists. For tiny single file fixes it lets you through.

Example `findings/` and `plans/` templates are in `research/template.md`. Also see `skills/research-first/SKILL.md`.

This caching is also why tokens drop a lot. Reading a cached finding is near instant versus re-researching for 30-60s.
