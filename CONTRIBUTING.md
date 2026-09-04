# Contributing

Thanks for stopping by.

## Setup

```bash
git clone https://github.com/TheElephantCoder/agent-harness.git
cd agent-harness
npm install
pip install -e ".[dev]"  # only if you use the python shim
harness doctor
```

## Adding a skill

```bash
harness skill create my-skill
# edit skills/my-skill/SKILL.md
harness doctor --fix
```

Keep `SKILL.md` frontmatter minimal (name, description, version) and under ~4k tokens. Put longer references in `references/`.

## Adding an instinct

```bash
harness instinct create my-instinct --event post-edit
# edit instincts/my-instinct/hook.json and the script
harness bench --task hooks  # keep p99 under 100ms
```

## Adding an adapter

Add `adapters/<name>/adapter.json` and a small `transpile.sh`, then run `harness doctor` to check it.

## Performance changes

Include a quick before/after:

```bash
harness bench --compare main
```

If it regresses more than ~10 percent, call it out in the PR description.

## Other stuff

- Don't commit secrets. `harness security audit` runs in CI.
- Keep PRs small if you can, easier to review.
- Commit style is loose, but `feat:`, `fix:`, `docs:`, `perf:` helps with changelog.

Checklist before you open a PR, if you remember:

- `harness doctor` passes
- `harness bench --quick` passes
- `harness security audit` passes
