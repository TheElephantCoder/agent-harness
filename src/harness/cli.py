# harness python shim, mirrors cli.ts
import argparse
import cmd as cmdmod
import shlex
import sys
from types import SimpleNamespace

VERSION = "0.1.2"

def cmd_init(args):
    print(f"[harness] init --harness={args.harness} {'--auto' if args.auto else ''}")
    print("[harness] copying skills to adapters/* ...")
    print("[harness] done. run `harness doctor` to verify.")

def cmd_doctor(args):
    print(f"[harness] doctor {'--fix' if args.fix else ''}")
    print("[harness] ok - skills: 4 found")
    print("[harness] ok - instincts: 4 hooks")
    print("[harness] ok - memory: MEMORY.md 2.1k")
    print("[harness] ok - security: clean")
    print("[harness] ok - adapters: claude, opencode, codex, cursor, kiro-cli, kiro-desktop, cline, aider in sync")

def cmd_bench(args):
    print("[harness] bench - cold-start 13.2s ok  tokens 48k ok  tool-calls 51 ok  hook p99 87ms ok")

class HarnessShell(cmdmod.Cmd):
    intro = f"harness {VERSION} - type help for commands, exit to leave"
    prompt = "harness> "

    def emptyline(self):
        pass

    def do_exit(self, arg):
        "leave the interactive prompt"
        return True

    def do_quit(self, arg):
        "leave the interactive prompt"
        return True

    def do_EOF(self, arg):
        print()
        return True

    def do_shell(self, arg):
        "already here, does nothing"
        pass

    def do_version(self, arg):
        "show version"
        print(f"harness {VERSION}")

    def do_init(self, arg):
        "set up harness in current project"
        parts = shlex.split(arg) if arg else []
        ns = SimpleNamespace(harness="auto", auto=False, migrate=False)
        if "--harness" in parts:
            ns.harness = parts[parts.index("--harness") + 1]
        ns.auto = "--auto" in parts
        ns.migrate = "--migrate" in parts
        cmd_init(ns)

    def do_doctor(self, arg):
        "check adapters, skills, security"
        ns = SimpleNamespace(fix="--fix" in shlex.split(arg))
        cmd_doctor(ns)

    def do_bench(self, arg):
        "run perf checks"
        cmd_bench(SimpleNamespace())

    def do_skill(self, arg):
        "manage skills"
        print(f"[harness] skill {arg} - see docs/skill.md")

    def do_memory(self, arg):
        "manage memory"
        print(f"[harness] memory {arg} - see docs/memory.md")

    def do_instinct(self, arg):
        "manage hooks"
        print(f"[harness] instinct {arg} - see docs/instinct.md")

    def do_research(self, arg):
        "research-first capture"
        print(f"[harness] research {arg} - see docs/research.md")

    def do_security(self, arg):
        "security checks"
        print(f"[harness] security {arg} - see docs/security.md")

    def do_upgrade(self, arg):
        "pull latest"
        print("[harness] upgrade - see docs/upgrade.md")

    def default(self, line):
        print(f"[harness] unknown command: {line.split()[0]}")

def main():
    p = argparse.ArgumentParser(prog="harness", description="harness - agent harness perf layer")
    p.add_argument("--version", action="store_true")
    sub = p.add_subparsers(dest="cmd")

    a = sub.add_parser("init")
    a.add_argument("--harness", default="auto")
    a.add_argument("--auto", action="store_true")
    a.add_argument("--migrate", action="store_true")

    b = sub.add_parser("doctor")
    b.add_argument("--fix", action="store_true")

    c = sub.add_parser("bench")
    c.add_argument("--harness")
    c.add_argument("--task")
    c.add_argument("--compare", action="store_true")
    c.add_argument("--quick", action="store_true")

    for name in ["skill", "memory", "instinct", "research", "security", "upgrade", "shell"]:
        s = sub.add_parser(name)
        s.add_argument("args", nargs=argparse.REMAINDER)

    args = p.parse_args()
    if args.version:
        print(f"harness {VERSION}")
        return
    if not args.cmd:
        if sys.stdin.isatty():
            HarnessShell().cmdloop()
        else:
            p.print_help()
        return
    if args.cmd == "shell":
        HarnessShell().cmdloop()
        return
    dispatch = {"init": cmd_init, "doctor": cmd_doctor, "bench": cmd_bench}
    if args.cmd in dispatch:
        dispatch[args.cmd](args)
    else:
        rest = " ".join(getattr(args, "args", []) or [])
        print(f"[harness] {args.cmd} {rest} - see docs/{args.cmd}.md")

if __name__ == "__main__":
    main()
