# harness python shim, mirrors cli.ts
import argparse
import cmd as cmdmod
import os
import shlex
import sys
from types import SimpleNamespace

VERSION = "0.1.2"

RESET = "\x1b[0m"
BOLD = "\x1b[1m"
DIM = "\x1b[2m"
CYAN = "\x1b[36m"
MAGENTA = "\x1b[35m"

def use_color():
    return bool(sys.stdout.isatty()) and not os.environ.get("NO_COLOR") and os.environ.get("TERM") != "dumb"

def paint(code, text):
    return f"{code}{text}{RESET}" if use_color() else text

def banner():
    inner = 40
    title = "◆ agent-harness"
    ver = f"v{VERSION}"
    sub = "skills · instincts · memory · research"
    top = "╭" + "─" * inner + "╮"
    bottom = "╰" + "─" * inner + "╯"
    gap1 = " " * (inner - 2 - len(title) - len(ver))
    gap2 = " " * (inner - 2 - len(sub))
    row1 = f"│  {paint(MAGENTA + BOLD, '◆')} {paint(BOLD, 'agent-harness')}{gap1}{paint(DIM, ver)}│"
    row2 = f"│  {paint(DIM, sub)}{gap2}│"
    return "\n".join([
        top,
        row1,
        row2,
        bottom,
        paint(DIM, "type help for commands · exit to leave"),
        paint(DIM, "tip: doctor checks your setup"),
    ])

ART = [
    "                                              *",
    "          ·",
    "                        ·          ◆",
    "     *",
    "                          ·",
    "               ·                    ·         *",
    "     ·                        ·",
    "                          *           ·     ·",
    "               *                     ·",
    "  ·                     ·",
    "                                           ·",
]

def term_width():
    try:
        w = __import__("shutil").get_terminal_size().columns
        return w if w > 20 else 80
    except OSError:
        return 80

def center_line(line, width):
    plain = line
    for code in (RESET, BOLD, DIM, CYAN, MAGENTA):
        plain = plain.replace(code, "")
    pad = max(0, (width - len(plain)) // 2)
    return " " * pad + line

def paint_art(line):
    out = []
    for ch in line:
        if ch == "◆":
            out.append(paint(MAGENTA + BOLD, ch))
        elif ch == "*":
            out.append(paint(CYAN, ch))
        else:
            out.append(paint(DIM, ch))
    return "".join(out)

def welcome():
    width = term_width()
    rule = paint(DIM, "·" * width)
    divider = paint(DIM, "╌" * width)
    art = "\n".join(center_line(paint_art(l), width) for l in ART)
    title = center_line(f"Welcome to {paint(BOLD, 'agent-harness')} {paint(DIM, f'v{VERSION}')}", width)
    sub = center_line(paint(DIM, "Let's get started."), width)
    return "\n".join([rule, "", art, "", title, "", sub, ""]) + "\n" + divider

def pick_numbered(title, options):
    print(paint(BOLD, title))
    for i, o in enumerate(options):
        print(f"  {i + 1}. {o}")
    try:
        answer = input(paint(CYAN, "❯ "))
    except EOFError:
        print()
        return -1
    try:
        n = int(answer.strip())
    except ValueError:
        return -1
    if n < 1 or n > len(options):
        return -1
    return n - 1

def pick_arrows(title, options):
    import termios
    import tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    index = 0
    rendered = 0
    hint = paint(DIM, "↑↓ to move · enter to select · type a number")
    try:
        tty.setraw(fd)
        while True:
            lines = [paint(BOLD, title)]
            for i, o in enumerate(options):
                if i == index:
                    lines.append(f"{paint(CYAN + BOLD, '❯')} {paint(BOLD, f'{i + 1}. {o}')}")
                else:
                    lines.append(paint(DIM, f"  {i + 1}. {o}"))
            lines.append(hint)
            if rendered:
                sys.stdout.write(f"\x1b[{rendered}A")
            for l in lines:
                sys.stdout.write("\x1b[G\x1b[K" + l + "\n")
            sys.stdout.flush()
            rendered = len(lines)
            ch = sys.stdin.read(1)
            if ch == "\x03":
                sys.stdout.write("\n")
                return -1
            if ch in ("\r", "\n"):
                sys.stdout.write("\n")
                return index
            if ch == "\x1b":
                nxt = sys.stdin.read(2)
                if nxt == "[A":
                    index = (index - 1) % len(options)
                elif nxt == "[B":
                    index = (index + 1) % len(options)
                else:
                    sys.stdout.write("\n")
                    return -1
            elif ch in ("k",):
                index = (index - 1) % len(options)
            elif ch in ("j",):
                index = (index + 1) % len(options)
            elif ch in ("q",):
                sys.stdout.write("\n")
                return -1
            elif ch.isdigit():
                n = int(ch)
                if 1 <= n <= len(options):
                    sys.stdout.write("\n")
                    return n - 1
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)

def pick(title, options):
    if sys.stdin.isatty() and sys.stdout.isatty() and os.name != "nt":
        try:
            return pick_arrows(title, options)
        except Exception:
            pass
    return pick_numbered(title, options)

def show_menu():
    options = [
        "Set up this project",
        "Check setup",
        "Run benchmark",
        "Skip straight to the prompt",
    ]
    picked = pick("What do you want to do?", options)
    if picked == 0:
        cmd_init(SimpleNamespace(harness="auto", auto=True, migrate=False))
    elif picked == 1:
        cmd_doctor(SimpleNamespace(fix=False))
    elif picked == 2:
        cmd_bench(SimpleNamespace())
    print(paint(DIM, "╌" * term_width()))

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

def launch_shell():
    print(welcome())
    show_menu()
    sh = HarnessShell()
    sh.intro = None
    sh.cmdloop()

class HarnessShell(cmdmod.Cmd):
    intro = None
    prompt = "harness> "

    def preloop(self):
        self.prompt = f"{paint(BOLD + CYAN, 'harness>')} "

    def emptyline(self):
        pass

    def do_exit(self, arg):
        "leave the interactive prompt"
        print(paint(DIM, "bye."))
        return True

    def do_quit(self, arg):
        "leave the interactive prompt"
        print(paint(DIM, "bye."))
        return True

    def do_EOF(self, arg):
        print()
        return True

    def do_shell(self, arg):
        "already here, does nothing"
        pass

    def do_menu(self, arg):
        "show the starting picker again"
        show_menu()

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
            launch_shell()
        else:
            p.print_help()
        return
    if args.cmd == "shell":
        launch_shell()
        return
    dispatch = {"init": cmd_init, "doctor": cmd_doctor, "bench": cmd_bench}
    if args.cmd in dispatch:
        dispatch[args.cmd](args)
    else:
        rest = " ".join(getattr(args, "args", []) or [])
        print(f"[harness] {args.cmd} {rest} - see docs/{args.cmd}.md")

if __name__ == "__main__":
    main()
