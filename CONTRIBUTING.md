# Contributing

Thanks for stopping by.

## Setup

```bash
git clone https://github.com/TheElephantCoder/agent-harness.git
cd agent-harness
npm ci
pip install -e ".[dev]"  # only if you use the python shim
harness doctor
```

## Development checks

Use Node 20.19+ (or Node 22.12+) for development tooling. The published CLI
continues to support Node 20+.

```bash
npm run build
npm run lint
npm test
python -m pytest tests/ -q
npm audit
```

Tests use Node's built-in test runner and assertions, with `tsx` loading
TypeScript. Oxlint explicitly enables the rules previously used from
`typescript-eslint/recommended`, including the existing underscore exceptions
for unused parameters and caught errors. Prettier remains the formatter.

This toolchain removes the unpatched `picomatch` dependency described in
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf),
rather than excluding development dependencies from the audit.

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
