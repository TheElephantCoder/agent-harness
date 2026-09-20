# CLI

```
harness init [--harness <name>] [--auto] [--migrate]
harness doctor [--fix] [--strict]
harness bench [--compare] [--quick]
harness optimize
harness map
harness skill <list|search|info|add|remove|verify> [query|name|repo]
harness memory <show|prune|sync|edit> [note]
harness instinct <list|enable|disable> [name]
harness research [query]
harness security <audit|scan> [--staged]
harness adapter <list|add> [name]
harness upgrade
harness shell
```

Run `harness` with no args on a terminal to open the interactive prompt: a menu covering every command (with guided prompts for arguments), then a `harness>` shell where every command works the same, plus `exit` and `quit` to leave. With arguments (`harness doctor --fix`), it just runs the action directly.

Anything not listed here prints `not implemented yet`. Every number the CLI prints comes from a measurement it just took. Token counts are estimates (~4 chars each) and always shown with a `~`.

## init

Installs the harness into the current project. Never overwrites existing files.

```bash
harness init --auto                   # detect harnesses from project files, install those
harness init --harness claude         # install for one harness
harness init --harness claude,opencode
harness init --migrate                # fill in files added since you last ran init
```

What it writes: `AGENTS.md`, `MEMORY.md` (plus per-harness copies like `.kiro/AGENTS.md` when needed), skills in each adapter's native format (table below), hook scripts under `.harness/hooks/`, and a manifest at `.harness/config.json` that `doctor` verifies.

Skill formats per harness (each verified against that tool's docs):

- claude, opencode, codex, kiro-cli, generic: verbatim `<skillPath>/<name>/SKILL.md` (codex uses the current `.agents/skills` repo scope)
- cursor: `<name>.mdc` with `description` + `alwaysApply: false` (agent-requested; plain `.md` is ignored by Cursor)
- kiro-desktop: `<name>.md` steering files with `inclusion: auto` + name/description
- cline: flat `<name>.md` rules in `.clinerules/` plus `00-harness-instincts.md`
- aider: all skills concatenated into `CONVENTIONS.md`

Hook auto-wiring (each verified against that tool's docs, written only when absent,
never merged into existing files):

- claude: `.claude/settings.json` (SessionStart/PreToolUse/PostToolUse/PreCommit, ms timeouts)
- cursor: `.cursor/hooks.json` v1 (sessionStart/preToolUse/afterFileEdit, exit 2 blocks, seconds)
- kiro-cli, kiro-desktop: `.kiro/hooks/session-hydrate.json` (SessionStart + Agent Spawn),
  `pre-tool-guard.json` (Pre Tool Use), `post-tool-check.json` (Post Tool Use), seconds.
  Blocking there depends on Kiro honoring non-zero exits.
- opencode: `.opencode/plugins/harness.js` (tool.execute.before runs guard and throws
  to block, proven live; .after runs check; session hydration via AGENTS.md)
- codex: `.codex/hooks.json` (SessionStart/PreToolUse/PostToolUse, exit 2 + stderr
  blocks, seconds, git-rooted commands; review with `/hooks` on first run)
- aider: `.aider.conf.yml` with `read: CONVENTIONS.md`
- cline: instincts ship inside `.clinerules/` as `00-harness-instincts.md` (no hooks system)
- generic: scripts under `.harness/hooks/`, nothing to wire into

`init` never edits an existing config file; it prints a merge pointer instead.

`--migrate` adds missing files without touching anything already there. Running plain `init` twice errors out and tells you to use `--migrate`.

## doctor

Checks the install and the project. Exit code is 1 when anything fails, so it works as a CI gate.

- skills: every `SKILL.md` present with `name` and `description` frontmatter
- hooks: every hook script present and executable (`--fix` chmods them back)
- adapters: every `adapter.json` parses and has `name` plus `skillPath`, every referenced `transpile.sh` exists and is executable
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

## optimizations

Local-model cost controls, all on by default. Stored per project in
`.harness/config.json` (`optimizations: {name: bool}`, `disabledByPerf: [...]`).
`init` writes defaults; `migrate` never resets your choices.

```bash
harness optimizations                  # status table with scopes
harness optimizations disable map-index
harness optimizations enable all
```

| name | scope | what it does when on |
|---|---|---|
| slim-agents | ram | `init` installs slim AGENTS.md (~180 tok) instead of full (~490 tok) |
| prune-memory | ram | `optimize`/`sync` keep MEMORY.md within the 2k budget |
| map-index | ram | `init` writes `.harness/MAP.md` file index |
| fast-hooks | cpu | `optimize` times hooks and disables any averaging over 2s (recorded, `doctor --fix` respects it) |
| archive-rotate | disk | `optimize` caps `MEMORY.archive.md` at 500 lines |

The interactive prompt has the same controls under menu item 4 ("Manage
optimizations"). Mechanism notes with local measurements: slim-vs-full
prefill runs ~0.6s vs ~2.6s on qwen2.5-coder:1.5b/M4 (linear ~1ms/token);
server RAM stays flat across prompt sizes at fixed `num_ctx` (KV
pre-allocated at load), so the RAM lever is context size plus a matching
`num_ctx`, not the prompt alone. See `benchmarks.md`.

## map

Deterministic repo index for agents (and humans). Walks source files
(`.ts` `.js` `.py` `.md` `.json` `.sh`, skips dotfiles, `node_modules`,
`dist`, `.git`), extracts exported symbols, writes `.harness/MAP.md`:

```bash
harness map   # 200 files -> ~229-line index, ~2.8k tokens on megabox
```

Same output byte-for-byte on repeat runs. `init` writes (and `--migrate`
refreshes) the map automatically; `AGENTS.md` points agents at it before
exploring. Re-run `map` (or `init --migrate`) after restructuring.

## skill / instinct / memory / adapter

```bash
harness skill list        # name, description, ~tokens from frontmatter
harness skill search tok  # grep names, descriptions, bodies
harness skill info NAME   # print the SKILL.md
harness skill add owner/repo[@ref]     # GitHub tarball, validate, pin
harness skill add https://host/skill.md  # raw file, same validation
harness skill add https://host/pack.tar.gz  # archive with SKILL.md inside
harness skill add --path ./dir           # local dir (SKILL.md at root or skills/*/)
harness skill remove NAME   # delete project-added skill + drop its pin
harness skill verify [NAME] # re-check pins against files
harness instinct list     # hook scripts with exec bit
harness instinct disable guard   # chmod -x matching hooks (enable reverses)
harness memory show       # print MEMORY.md
harness memory sync "note"  # append a dated note, re-prune to budget
harness memory prune      # same prune as optimize
harness memory edit       # open MEMORY.md in $EDITOR (terminal only)
harness adapter list      # supported harnesses from adapters/
harness adapter add mytool  # scaffold .harness/adapters/mytool/ (fill skillPath, init picks it up)
harness research "query"  # capture a findings stub to fill in
harness research          # list captured findings
harness security audit    # run security/audit.sh here (scan = --staged)
```

`init` records a sha256 per installed file in `.harness/config.json`
(plus `addedSkills` pins from `skill add`). `doctor` re-hashes and reports
missing or modified files. Old manifests without hashes still verify by existence.

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

## cursor / codex / kiro merge snippets

When those config files already exist, `init` leaves them alone. Merge by hand:

```json
// .cursor/hooks.json (add alongside your existing hooks)
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": ".harness/hooks/session-start--hydrate.sh", "timeout": 15 }],
    "preToolUse": [{ "command": ".harness/hooks/pre-tool--guard.sh", "timeout": 5 }],
    "afterFileEdit": [{ "command": ".harness/hooks/post-edit--check.sh", "timeout": 5 }]
  }
}
```

```json
// .codex/hooks.json (review with /hooks on first run)
{
  "hooks": {
    "SessionStart": [{ "matcher": "startup|resume", "hooks": [
      { "type": "command", "command": "bash \"$(git rev-parse --show-toplevel)/.harness/hooks/session-start--hydrate.sh\"", "timeout": 15 }
    ] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [
      { "type": "command", "command": "bash \"$(git rev-parse --show-toplevel)/.harness/hooks/pre-tool--guard.sh\"", "timeout": 5 }
    ] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [
      { "type": "command", "command": "bash \"$(git rev-parse --show-toplevel)/.harness/hooks/post-edit--check.sh\"", "timeout": 5 }
    ] }]
  }
}
```

```json
// .kiro/hooks/session-hydrate.json (same shape for guard/check files)
{
  "version": "v1",
  "hooks": [
    { "name": "harness hydrate on session start", "trigger": "SessionStart",
      "action": { "type": "command", "command": "./.harness/hooks/session-start--hydrate.sh" }, "timeout": 15 },
    { "name": "harness hydrate on agent spawn", "trigger": "Agent Spawn",
      "action": { "type": "command", "command": "./.harness/hooks/session-start--hydrate.sh" }, "timeout": 15 }
  ]
}
```
