---
name: research-first
description: Look things up before you code. Use for features, bug fixes, or anything that touches more than trivial code.
version: 1.0.0
license: MIT
allowed-tools: [read, grep, glob, bash, webfetch, websearch, write, edit]
triggers:
  - "implement"
  - "build"
  - "create"
  - "fix"
  - "refactor"
metadata:
  category: workflow
---

# Research first

Don't code from what you think the API is. Check first.

You need to do this before any `edit` or `write` that isn't trivial:

### 1. Research: `research/findings/<topic>.md`

- Check `research/findings/` first. If someone already researched it, reuse it.
- Then grep the codebase. Then web search if you need external docs. Use 2026 when you search so you get current docs.
- Cite what you found. If docs don't exist, write a small repro to verify the hypothesis.
- Save it to `research/findings/<slug>.md` so the next session doesn't redo the work.

Template:

```markdown
# Findings: <topic>
Date: 2026-09-04
Sources: [url, url]
Existing code: `path:line`: what we found

## Verdict
Recommended approach: ...
Alternatives: ...
Risks: ...
```

### 2. Plan: `research/plans/<task>.md`

```markdown
# Plan: <task>
Research: research/findings/<topic>.md
Approach: ...
Files to change: [list]
Tests: ...
Rollback: ...
```

### 3. Approval

Show the plan to the user. Don't start coding until they say ok. For tiny single file edits the auto-approve instinct may let you through.

### 4. Implement and verify

Build the plan, run tests, `harness bench --quick`, then `harness memory sync` so the next session remembers what worked.

## Notes

- If findings already exist, don't redo them.
- Read files for facts, don't guess. If what you find contradicts what you expected, say so and trust the file.
- After you're done, update findings with what actually worked.

## Don't do this

- `edit` before `read` or `grep`
- guessing API signatures
- skipping the plan because "its small" when you are about to touch 3+ files
