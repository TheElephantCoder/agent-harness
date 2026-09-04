# Security

Nothing clever here, just some guardrails so agents don't leak secrets or run nonsense.

- prompt injection check on external content
- secret scanning before commits
- bash allowlist and file write boundaries
- pinned skill versions

```bash
harness security audit        # whole repo
harness security scan --staged # just staged files
```

Config lives in `security/policy.md`, `security/bash-allowlist.json`, `security/allowlist.txt`.

Runs in CI on every PR. See `skills/security-guard/SKILL.md` for what the agent actually checks.
