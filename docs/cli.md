# CLI

```
harness init [--harness <name>] [--auto] [--migrate]
harness doctor [--fix] [--strict]
harness bench [--harness <n>] [--task <t>] [--compare] [--quick] [--profile]
harness skill <add|list|remove|search|info|create|verify> [name]
harness memory <sync|show|edit|prune> [--dry-run] [--auto]
harness instinct <list|enable|disable|create> [name] [--event <e>]
harness research <query> [--plan] [--evidence]
harness security <audit|scan|fix> [--staged] [--dry-run]
harness adapter <list|add> [name]
harness upgrade
```

## init

```bash
harness init                          # interactive
harness init --harness claude,opencode
harness init --auto                   # detect what you use
harness init --migrate                # update without overwriting
```

## doctor

Checks skills frontmatter, hook timeouts, memory size, adapter sync, secret scan.

## bench

Measures cold start, tokens, tool calls, hook overhead. Quick mode is about 30s.

## skill

```bash
harness skill list
harness skill search "react"
harness skill add owner/repo
harness skill verify my-skill
```
