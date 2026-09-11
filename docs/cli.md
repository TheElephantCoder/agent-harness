# CLI

```
harness init [--harness <name>] [--auto] [--migrate]
harness doctor [--fix] [--strict]
harness bench [--compare] [--quick]
harness optimize
harness skill list
harness memory <show|prune>
harness instinct list
harness adapter list
harness upgrade
harness shell
```

Run `harness` with no args on a terminal to open the interactive prompt. Inside, every command works the same, plus `exit` and `quit` to leave.

Anything not listed here prints `not implemented yet`. Every number the CLI prints comes from a measurement it just took. Token counts are estimates (~4 chars each) and always shown with a `~`.

## init

Installs the harness into the current project. Never overwrites existing files.

```bash
harness init --auto                   # detect harnesses from project files, install those
harness init --harness claude         # install for one harness
harness init --harness claude,opencode
harness init --migrate                # fill in files added since you last ran init
```

What it writes: `AGENTS.md`, `MEMORY.md` (plus per-harness copies like `.kiro/AGENTS.md` when needed), skills under each adapter's `skillPath`, hook scripts under `.harness/hooks/`, and a manifest at `.harness/config.json` that `doctor` verifies. For Claude it also writes `.claude/settings.json` wiring the hooks, but only when that file does not exist yet.

`--migrate` adds missing files without touching anything already there. Running plain `init` twice errors out and tells you to use `--migrate`.

## doctor

Checks the install and the project. Exit code is 1 when anything fails, so it works as a CI gate.

- skills: every `SKILL.md` present with `name` and `description` frontmatter
- hooks: every hook script present and executable (`--fix` chmods them back)
- adapters: every `adapter.json` parses and has `name` plus `skillPath`
- project: every file in `.harness/config.json` still present (only when initialized)
- memory: warns when `MEMORY.md` passes ~4k tokens
- security: scans staged git changes for secret patterns (keys, tokens)

`--strict` turns warnings into failures.

## bench

Measures real costs and saves a baseline to `.harness/bench.json`:

- cold-start: time to spawn the CLI (`want <1500ms`)
- hooks: each hook script executed (3 runs, 1 with `--quick`), mean ms plus exit code
- skills: per-skill and total `~tokens` (`want <50k`)
- adapters: parse plus validate all `adapter.json`

`bench --compare` diffs the fresh run against the saved baseline. First run just saves it.

## optimize

The part that actually cuts cost:

- prunes `MEMORY.md` to a 2k token budget, appending overflow to `MEMORY.archive.md` (nothing is deleted, the archive keeps growing)
- repairs hook executables
- prints the skill cost table with the largest skill

`harness memory prune` does the same prune. Exits 1 only when the prune itself fails.

## skill / instinct / memory / adapter

Read-only helpers, all measured from disk:

```bash
harness skill list        # name, description, ~tokens from frontmatter
harness instinct list     # hook scripts with exec bit
harness memory show       # print MEMORY.md
harness adapter list      # supported harnesses from adapters/
```

## claude settings merge

When `.claude/settings.json` already exists, `init` leaves it alone. Merge the hooks block by hand:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "./.harness/hooks/session-start--hydrate.sh",
            "timeout": 15000
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "./.harness/hooks/pre-tool--guard.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "./.harness/hooks/post-edit--check.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "PreCommit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "./.harness/hooks/security--audit.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```
