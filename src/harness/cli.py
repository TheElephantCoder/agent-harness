# harness python shim, mirrors cli.ts
import argparse
import atexit
import cmd as cmdmod
import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime
from types import SimpleNamespace
from urllib.request import Request, urlopen

VERSION = "0.2.1"

RESET = "\x1b[0m"
BOLD = "\x1b[1m"
DIM = "\x1b[2m"
CYAN = "\x1b[36m"
MAGENTA = "\x1b[35m"

def use_color():
    return bool(sys.stdout.isatty()) and not os.environ.get("NO_COLOR") and os.environ.get("TERM") != "dumb"

def paint(code, text):
    return f"{code}{text}{RESET}" if use_color() else text

ART = [
    "                                              *",
    "          ·                             *",
    "                        ·          ◆",
    "     *                       ·",
    "                          ·",
    "               ·                    ·         *",
    "     ·                        ·",
    "                          *           ·     ·",
    "               *                     ·",
    "  ·                     ·                      ◆",
    "                                           ·",
]

def term_width():
    try:
        w = shutil.get_terminal_size().columns
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
    credit = center_line(paint(DIM, "by TheElephantCoder"), width)
    return "\n".join([rule, "", art, "", title, "", sub, credit, ""]) + "\n" + divider

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
    # first digit of a two-digit option number, with its timestamp.
    pending, pending_at = 0, 0.0
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
            if pending:
                import select as selectmod
                wait = 0.45 - (time.monotonic() - pending_at)
                if wait <= 0:
                    sys.stdout.write("\n")
                    return pending - 1
                r, _, _ = selectmod.select([fd], [], [], wait)
                if not r:
                    sys.stdout.write("\n")
                    return pending - 1
            ch = sys.stdin.read(1)
            if ch == "\x03":
                sys.stdout.write("\n")
                return -1
            if ch in ("\r", "\n"):
                sys.stdout.write("\n")
                return index
            if ch == "\x1b":
                pending = 0
                nxt = sys.stdin.read(2)
                if nxt == "[A":
                    index = (index - 1) % len(options)
                elif nxt == "[B":
                    index = (index + 1) % len(options)
                else:
                    sys.stdout.write("\n")
                    return -1
            elif ch in ("k",):
                pending = 0
                index = (index - 1) % len(options)
            elif ch in ("j",):
                pending = 0
                index = (index + 1) % len(options)
            elif ch in ("q",):
                sys.stdout.write("\n")
                return -1
            elif ch.isdigit():
                d = int(ch)
                if pending and time.monotonic() - pending_at < 0.45:
                    two = pending * 10 + d
                    first = pending
                    pending = 0
                    if 1 <= two <= len(options):
                        sys.stdout.write("\n")
                        return two - 1
                    if 1 <= first <= len(options):
                        sys.stdout.write("\n")
                        return first - 1
                elif d >= 1 and (d * 10 > len(options) or len(options) < 10):
                    sys.stdout.write("\n")
                    return d - 1
                elif d >= 1:
                    pending, pending_at = d, time.monotonic()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)

def pick(title, options):
    if sys.stdin.isatty() and sys.stdout.isatty() and os.name != "nt":
        try:
            return pick_arrows(title, options)
        except Exception:
            pass
    return pick_numbered(title, options)

def ask_question(prompt):
    try:
        return input(paint(CYAN, prompt + " ")).strip()
    except (EOFError, OSError):
        print()
        return ""

def pick_adapter(title):
    root = self_root()
    if not root:
        print("[harness] adapter - cannot locate install")
        return None
    names = [a["name"] for a in list_adapters(root) if a["json"]]
    picked = pick(title, names + ["Back"])
    if picked is None or picked < 0 or picked >= len(names):
        return None
    return names[picked]

def show_menu():
    options = [
        "Set up this project",
        "Check setup",
        "Project status",
        "Run benchmark",
        "Optimize this project",
        "Manage optimizations",
        "Map this repo",
        "Skills",
        "Memory",
        "Instincts",
        "Research",
        "Security",
        "Adapters",
        "Upgrade",
        "Skip straight to the prompt",
    ]
    picked = pick("What do you want to do?", options)
    if picked == 0:
        setup_menu()
    elif picked == 1:
        check_menu()
    elif picked == 2:
        cmd_status()
    elif picked == 3:
        bench_menu()
    elif picked == 4:
        cmd_optimize()
    elif picked == 5:
        show_optimizations_menu()
    elif picked == 6:
        cmd_map()
    elif picked == 7:
        skills_menu()
    elif picked == 8:
        memory_menu()
    elif picked == 9:
        instinct_menu()
    elif picked == 10:
        research_menu()
    elif picked == 11:
        security_menu()
    elif picked == 12:
        adapter_menu()
    elif picked == 13:
        cmd_upgrade()
    print(paint(DIM, "╌" * term_width()))

def setup_menu():
    picked = pick("Set up this project", [
        "Auto-detect + install",
        "Install for a specific harness",
        "Migrate (fill gaps)",
        "Back",
    ])
    if picked == 0:
        cmd_init(SimpleNamespace(harness="auto", auto=True, migrate=False))
    elif picked == 1:
        name = pick_adapter("Install for which harness?")
        if name:
            initialized = os.path.exists(os.path.join(os.getcwd(), ".harness", "config.json"))
            ns = SimpleNamespace(harness=name, auto=False, migrate=initialized)
            cmd_init(ns)
    elif picked == 2:
        cmd_init(SimpleNamespace(harness="auto", auto=True, migrate=True))

def check_menu():
    picked = pick("Check setup", ["Check", "Check + fix", "Strict check", "Back"])
    if picked == 0:
        cmd_doctor(SimpleNamespace(fix=False, strict=False))
    elif picked == 1:
        cmd_doctor(SimpleNamespace(fix=True, strict=False))
    elif picked == 2:
        cmd_doctor(SimpleNamespace(fix=False, strict=True))

def bench_menu():
    picked = pick("Run benchmark", ["Quick", "Full", "Compare with baseline", "Back"])
    if picked == 0:
        cmd_bench(SimpleNamespace(quick=True, compare=False))
    elif picked == 1:
        cmd_bench(SimpleNamespace(quick=False, compare=False))
    elif picked == 2:
        cmd_bench(SimpleNamespace(quick=False, compare=True))

def skills_menu():
    picked = pick("Skills", ["List", "Search", "Show info", "Add", "Remove", "Verify", "Back"])
    if picked == 0:
        cmd_skill_list()
    elif picked == 1:
        q = ask_question("Search skills for?")
        if q:
            cmd_skill_search(q)
    elif picked == 2:
        n = ask_question("Which skill?")
        if n:
            cmd_skill_info(n)
    elif picked == 3:
        s = ask_question("Add what? (owner/repo, URL, or --path dir)")
        if s:
            cmd_skill_add(shlex.split(s))
    elif picked == 4:
        n = ask_question("Remove which added skill?")
        if n:
            cmd_skill_remove(n)
    elif picked == 5:
        cmd_skill_verify(None)

def memory_menu():
    picked = pick("Memory", ["Show", "Prune", "Sync a note", "Edit", "Back"])
    if picked == 0:
        text = read_text(os.path.join(os.getcwd(), "MEMORY.md"))
        print(text if text is not None else "[harness] memory - no MEMORY.md here (run harness init)")
    elif picked == 1:
        cmd_optimize()
    elif picked == 2:
        n = ask_question("Note to append?")
        if n:
            cmd_memory_sync(n)
    elif picked == 3:
        cmd_memory_edit()

def instinct_menu():
    picked = pick("Instincts", ["List", "Enable", "Disable", "Back"])
    if picked == 0:
        cmd_instinct_list()
    elif picked in (1, 2):
        n = ask_question(f"{'Enable' if picked == 1 else 'Disable'} which hook?")
        if n:
            cmd_instinct_toggle("enable" if picked == 1 else "disable", n)

def research_menu():
    picked = pick("Research", ["List findings", "Capture query", "Back"])
    if picked == 0:
        cmd_research_list()
    elif picked == 1:
        q = ask_question("Query to capture?")
        if q:
            cmd_research(q)

def security_menu():
    picked = pick("Security", ["Audit", "Staged scan", "Back"])
    if picked == 0:
        cmd_security("audit", [])
    elif picked == 1:
        cmd_security("scan", [])

def adapter_menu():
    picked = pick("Adapters", ["List", "Add", "Back"])
    if picked == 0:
        cmd_adapter_list()
    elif picked == 1:
        n = ask_question("New adapter name? (lowercase-hyphen)")
        if n:
            cmd_adapter_add(n)

def show_optimizations_menu():
    while True:
        opts = read_optimizations(os.getcwd())
        print("[harness] optimizations (all on by default):")
        names = [o["name"] for o in OPTIMIZATIONS]
        for i, o in enumerate(OPTIMIZATIONS):
            print(f"  {i + 1}. {o['name']} [{o['scope']}] {'on' if opts[o['name']] else 'off'} - {o['desc']}")
        print(f"  {len(names) + 1}. Back")
        picked = pick("Toggle which?", [f"toggle {n}" for n in names] + ["Back"])
        if picked is None or picked < 0 or picked >= len(names):
            return
        name = names[picked]
        cmd_optimizations(["disable" if opts[name] else "enable", name])

def read_text(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None

def est_tokens(text):
    return (len(text) + 3) // 4

def fmt_tok(t):
    return f"{t / 1000:.1f}k" if t >= 1000 else str(t)

def parse_frontmatter(text):
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    out = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        out[k.strip()] = v.strip()
    if not out.get("name") or not out.get("description"):
        return None
    return {"name": out["name"], "desc": out["description"]}

def list_skills(root):
    try:
        entries = sorted(os.listdir(os.path.join(root, "skills")))
    except OSError:
        return []
    out = []
    for e in entries:
        f = os.path.join(root, "skills", e, "SKILL.md")
        text = read_text(f)
        if text is None:
            continue
        fm = parse_frontmatter(text)
        out.append({"name": e, "file": f, "tokens": est_tokens(text),
                    "desc": fm["desc"] if fm else "", "fm_ok": bool(fm)})
    return out

def list_hooks(root):
    try:
        groups = sorted(os.listdir(os.path.join(root, "instincts")))
    except OSError:
        return []
    out = []
    for g in groups:
        gd = os.path.join(root, "instincts", g)
        try:
            files = sorted(os.listdir(gd))
        except OSError:
            continue
        for f in files:
            if f.endswith(".sh"):
                out.append(os.path.join("instincts", g, f))
    return out

def list_adapters(root, sub="adapters"):
    base = os.path.join(root, sub)
    try:
        entries = sorted(os.listdir(base))
    except OSError:
        return []
    out = []
    for e in entries:
        d = os.path.join(base, e)
        if not os.path.isdir(d):
            continue
        text = read_text(os.path.join(d, "adapter.json"))
        if text is None:
            out.append({"name": e, "json": None, "error": "missing adapter.json"})
            continue
        try:
            j = json.loads(text)
        except ValueError:
            out.append({"name": e, "json": None, "error": "invalid JSON"})
            continue
        if not j.get("name") or not j.get("skillPath"):
            out.append({"name": e, "json": None, "error": "missing name/skillPath"})
        else:
            out.append({"name": j["name"], "json": j, "error": None})
    return out

def is_exec(p):
    return os.path.isfile(p) and os.access(p, os.X_OK)

def run_hook(abs_path, timeout_s=10):
    t0 = time.perf_counter()
    try:
        r = subprocess.run(["bash", abs_path], input="", timeout=timeout_s,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
        return (time.perf_counter() - t0) * 1000, r.returncode
    except (OSError, subprocess.TimeoutExpired):
        return (time.perf_counter() - t0) * 1000, None

def cmd_bench(args=None):
    root = self_root()
    if not root:
        missing_data("bench")
        return False
    quick = bool(getattr(args, "quick", False))
    compare = bool(getattr(args, "compare", False))
    runs = 1 if quick else 3
    print(f"[harness] bench - {runs} run{'s' if runs > 1 else ''} per hook (tokens are estimates, ~4 chars each)")
    ok = True
    t0 = time.perf_counter()
    subprocess.run([sys.executable, os.path.realpath(__file__), "--version"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cold = (time.perf_counter() - t0) * 1000
    cold_ok = cold < 1500
    if not cold_ok:
        ok = False
    print(f"  cold-start {cold:.0f}ms (want <1500ms) {'ok' if cold_ok else 'FAIL'}")
    hooks = list_hooks(root)
    if not hooks:
        print("  hooks: none found FAIL")
        ok = False
    hook_ms = {}
    for h in hooks:
        total, status = 0.0, 0
        for _ in range(runs):
            ms, st = run_hook(os.path.join(root, h))
            total += ms
            if st != 0:
                status = st
        mean = total / runs
        hook_ms[h] = round(mean, 1)
        good = status == 0
        if not good:
            ok = False
        mark = "FAIL" if not good else ("slow" if mean > 2000 else "ok")
        print(f"  hook {os.path.basename(h)} mean {mean:.0f}ms exit {status} {mark}")
    skills = list_skills(root)
    total_tok = sum(s["tokens"] for s in skills)
    skills_ok = bool(skills) and total_tok < 50000
    if not skills_ok:
        ok = False
    for s in skills:
        print(f"  skill {s['name']} ~{fmt_tok(s['tokens'])}")
    print(f"  skills {len(skills)} files ~{fmt_tok(total_tok)} (want <50k) {'ok' if skills_ok else 'FAIL'}")
    t0 = time.perf_counter()
    adapters = list_adapters(root)
    valid = sum(1 for a in adapters if a["json"])
    adapter_ms = (time.perf_counter() - t0) * 1000
    ad_ok = bool(adapters) and valid == len(adapters)
    if not ad_ok:
        ok = False
    for a in adapters:
        if not a["json"]:
            print(f"  adapter {a['name']}: {a['error']} FAIL")
    print(f"  adapters {valid}/{len(adapters)} valid in {adapter_ms:.0f}ms {'ok' if ad_ok else 'FAIL'}")
    baseline = {"version": VERSION, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "platform": platform.system(), "arch": platform.machine(),
                "runtime": "python " + sys.version.split()[0],
                "coldStartMs": round(cold, 1), "hooks": hook_ms,
                "skillTokens": total_tok, "adapterMs": round(adapter_ms, 1)}
    bfile = os.path.join(os.getcwd(), ".harness", "bench.json")
    if compare:
        prev = read_text(bfile)
        if prev is None:
            print("  compare: no baseline yet, saving current")
        else:
            try:
                p = json.loads(prev)
                def d(c, o):
                    diff = round(c - o, 1)
                    return f"{c} (was {o}, {'+' if diff > 0 else ''}{diff})"
                print(f"  compare cold-start {d(baseline['coldStartMs'], p['coldStartMs'])}ms")
                for h, ms in hook_ms.items():
                    if p.get("hooks", {}).get(h) is not None:
                        print(f"  compare hook {os.path.basename(h)} {d(ms, p['hooks'][h])}ms")
                if p.get("skillTokens") is not None:
                    print(f"  compare skills ~{fmt_tok(total_tok)} (was ~{fmt_tok(p['skillTokens'])})")
            except ValueError:
                print("  compare: baseline corrupt, overwriting")
    try:
        os.makedirs(os.path.dirname(bfile), exist_ok=True)
        with open(bfile, "w", encoding="utf-8") as f:
            json.dump(baseline, f, indent=2)
        print("[harness] baseline saved to .harness/bench.json")
    except OSError:
        print("[harness] warn - could not write .harness/bench.json")
    return ok

SECRET_PATTERNS = ["AKIA", "ghp_", "github_pat_", "xoxb-", "xoxa-", "xoxp-"]


def looks_like_pem(line):
    return "-----BEGIN" in line and "PRIVATE KEY-----" in line

def scan_staged():
    hits = []
    try:
        r = subprocess.run(["git", "diff", "--cached", "--no-color"], capture_output=True, text=True, timeout=30)
        out = r.stdout or ""
    except (OSError, subprocess.TimeoutExpired):
        return hits
    fname, line = "", 0
    for l in out.split("\n"):
        if l.startswith("+++ b/"):
            fname, line = l[6:], 0
            continue
        if l.startswith("+") and not l.startswith("+++"):
            line += 1
            if looks_like_pem(l) or any(p in l for p in SECRET_PATTERNS):
                if "AKIA" in l and not re.search(r"AKIA[0-9A-Z]{16}", l):
                    continue
                hits.append((fname, line))
    return hits

def fmt_age(ts):
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        ago = time.time() - dt.timestamp()
    except (ValueError, TypeError):
        return "unknown age"
    if ago < 0:
        return "unknown age"
    mins = int(ago // 60)
    if mins < 1:
        return "just now"
    if mins < 60:
        return f"{mins}m ago"
    h = mins // 60
    if h < 48:
        return f"{h}h ago"
    return f"{h // 24}d ago"

def status_line(cwd=None):
    """One-line project context for the shell opener."""
    cwd = cwd or os.getcwd()
    bits = []
    bits.append("initialized" if os.path.isfile(os.path.join(cwd, ".harness", "config.json"))
                else "not initialized")
    mem = read_text(os.path.join(cwd, "MEMORY.md"))
    bits.append("no MEMORY.md" if mem is None else f"MEMORY ~{fmt_tok(est_tokens(mem))}")
    root = self_root()
    if root is not None:
        bits.append(f"skills {len(list_skills(root))}")
    btext = read_text(os.path.join(cwd, ".harness", "bench.json"))
    if btext is not None:
        try:
            bits.append(f"bench {fmt_age(json.loads(btext).get('ts'))}")
        except (ValueError, TypeError, AttributeError):
            pass
    return "project: " + " · ".join(bits)

def cmd_status():
    """Project snapshot: init state, memory, findings, baseline, install.
    Reads only; never fails, missing pieces are reported as missing."""
    cwd = os.getcwd()
    hdir = os.path.join(cwd, ".harness")
    print("[harness] status")
    print("Project")
    if os.path.isfile(os.path.join(hdir, "config.json")):
        init_state = "yes"
    elif os.path.isdir(hdir):
        init_state = "partial (.harness/ without config.json)"
    else:
        init_state = "no"
    suffix = " (run harness init)" if init_state == "no" else ""
    print(f"  initialized: {init_state}{suffix}")
    mem = read_text(os.path.join(cwd, "MEMORY.md"))
    if mem is None:
        print("  MEMORY.md: missing")
    else:
        print(f"  MEMORY.md: ~{fmt_tok(est_tokens(mem))} tokens")
    try:
        findings = len([f for f in os.listdir(os.path.join(cwd, "research", "findings"))
                        if f.endswith(".md")])
    except OSError:
        findings = 0
    print(f"  research findings: {findings}")
    btext = read_text(os.path.join(hdir, "bench.json"))
    if btext is None:
        print("  last benchmark: none yet (run harness bench)")
    else:
        try:
            b = json.loads(btext)
            cold = f", cold-start {b['coldStartMs']}ms" if isinstance(b.get("coldStartMs"), (int, float)) else ""
            print(f"  last benchmark: {fmt_age(b.get('ts'))}{cold}")
        except (ValueError, TypeError, AttributeError):
            print("  last benchmark: baseline corrupt (run harness bench)")
    opts = read_optimizations(cwd)
    on = sum(1 for o in OPTIMIZATIONS if opts.get(o["name"]))
    print(f"  optimizations: {on}/{len(OPTIMIZATIONS)} on")
    root = self_root()
    if root is None:
        print("[harness] status - cannot locate install")
        return True
    print("Install")
    print(f"  version: {VERSION}")
    skills = list_skills(root)
    print(f"  skills: {len(skills)} (~{fmt_tok(sum(s['tokens'] for s in skills))} tokens)")
    hooks = list_hooks(root)
    print(f"  hooks: {len(hooks)} ({sum(1 for h in hooks if is_exec(os.path.join(root, h)))} executable)")
    adapters = list_adapters(root)
    print(f"  adapters: {sum(1 for a in adapters if a['json'])}/{len(adapters)} valid")
    return True

def cmd_doctor(args=None):
    root = self_root()
    if not root:
        missing_data("doctor")
        return False
    fix = bool(getattr(args, "fix", False))
    strict = bool(getattr(args, "strict", False))
    state = {"ok": True}
    def fail(s):
        print(s)
        state["ok"] = False
    def warn(s):
        print(s)
        if strict:
            state["ok"] = False
    skills = list_skills(root)
    bad_fm = [s["name"] for s in skills if not s["fm_ok"]]
    if not skills:
        fail("[harness] FAIL - skills: none found")
    elif bad_fm:
        fail(f"[harness] FAIL - skills frontmatter missing name/description: {', '.join(bad_fm)}")
    else:
        print(f"[harness] ok - skills: {len(skills)} checked, frontmatter ok")
    hooks = list_hooks(root)
    perf_off = read_disabled_by_perf(os.getcwd())
    noexec = [h for h in hooks if not is_exec(os.path.join(root, h))]
    skipped_perf = [h for h in noexec if h in perf_off]
    repairable = [h for h in noexec if h not in perf_off]
    if skipped_perf:
        print(f"[harness] info - left disabled by optimize: {', '.join(skipped_perf)}")
    if repairable:
        if fix:
            repaired = 0
            for h in repairable:
                try:
                    os.chmod(os.path.join(root, h), 0o755)
                    if is_exec(os.path.join(root, h)):
                        repaired += 1
                except OSError:
                    pass
            still = [h for h in hooks if not is_exec(os.path.join(root, h)) and h not in perf_off]
            if not still:
                print(f"[harness] ok - hooks: repaired exec on {repaired}, {len(hooks) - len(skipped_perf)} executable")
            else:
                fail(f"[harness] FAIL - hooks not executable: {', '.join(still)}")
        else:
            fail(f"[harness] FAIL - hooks not executable (run --fix): {', '.join(repairable)}")
    elif not hooks:
        fail("[harness] FAIL - hooks: none found")
    else:
        skipped = f" ({len(skipped_perf)} disabled by optimize)" if skipped_perf else ""
        print(f"[harness] ok - hooks: {len(hooks) - len(skipped_perf)} executable{skipped}")
    adapters = list_adapters(root)
    bad = [a for a in adapters if not a["json"]]
    if not adapters:
        fail("[harness] FAIL - adapters: none found")
    elif bad:
        fail("[harness] FAIL - adapters invalid: " + ", ".join(f"{a['name']} ({a['error']})" for a in bad))
    else:
        print(f"[harness] ok - adapters: {len(adapters)}/{len(adapters)} valid")
    tpl_bad = []
    for a in adapters:
        if not a["json"] or not a["json"].get("transpile"):
            continue
        if not re.fullmatch(r"[a-z0-9-]+", a["name"]):
            continue
        f = os.path.join(root, "adapters", a["name"], "transpile.sh")
        if not os.path.isfile(f):
            tpl_bad.append(f"{a['name']} (missing transpile.sh)")
            continue
        if not is_exec(f):
            if fix:
                try:
                    os.chmod(f, 0o755)
                except OSError:
                    pass
            if not is_exec(f):
                tpl_bad.append(f"{a['name']} (transpile.sh not executable)")
    if tpl_bad:
        fail(f"[harness] FAIL - adapter transpilers: {', '.join(tpl_bad)}")
    elif any(a["json"] and a["json"].get("transpile") for a in adapters):
        print("[harness] ok - adapter transpilers executable")
    man = read_text(os.path.join(os.getcwd(), ".harness", "config.json"))
    if man is not None:
        try:
            files = json.loads(man).get("files", [])
            rel_of = lambda f: f if isinstance(f, str) else f.get("path", "")
            missing = [rel_of(f) for f in files if not os.path.exists(os.path.join(os.getcwd(), rel_of(f)))]
            modified = []
            for f in files:
                if isinstance(f, str):
                    continue
                abs_path = os.path.join(os.getcwd(), f.get("path", ""))
                if not os.path.exists(abs_path):
                    continue
                text = read_text(abs_path)
                if text is not None and sha256(text) != f.get("sha"):
                    modified.append(f.get("path", ""))
            if missing:
                fail(f"[harness] FAIL - project init files missing: {', '.join(missing)}")
            if modified:
                fail(f"[harness] FAIL - project files modified: {', '.join(modified)} (delete + migrate to restore, or keep your edit)")
            if not missing and not modified:
                print(f"[harness] ok - project: {len(files)}/{len(files)} init files present, hashes match")
            added, _corrupt = read_added_skills(os.getcwd())
            added_bad = [r for r in (verify_added_skill(os.getcwd(), a) for a in added) if r]
            if added_bad:
                fail(f"[harness] FAIL - added skills: {', '.join(added_bad)}")
            elif added:
                print(f"[harness] ok - added skills: {len(added)} verified")
        except ValueError:
            fail("[harness] FAIL - project: .harness/config.json corrupt")
    else:
        print("[harness] info - project not initialized here (run harness init)")
    mem = read_text(os.path.join(os.getcwd(), "MEMORY.md"))
    ag = read_text(os.path.join(os.getcwd(), "AGENTS.md"))
    if mem is not None or ag is not None:
        print(f"[harness] info - project context ~{fmt_tok(est_tokens((mem or '') + (ag or '')))} tokens (AGENTS.md + MEMORY.md)")
    if mem is not None:
        t = est_tokens(mem)
        if t > 4000:
            warn(f"[harness] warn - MEMORY.md ~{fmt_tok(t)} tokens (run harness optimize)")
        else:
            print(f"[harness] ok - memory: MEMORY.md ~{fmt_tok(t)} tokens")
    try:
        in_repo = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except OSError:
        in_repo = False
    if not in_repo:
        print("[harness] info - security: not a git repo, staged scan skipped")
    else:
        hits = scan_staged()
        if hits:
            shown = ", ".join(f"{f}:{n}" for f, n in hits[:5])
            fail(f"[harness] FAIL - security: possible secrets in staged ({len(hits)}): {shown} - unstage and remove them")
        else:
            print("[harness] ok - security: no secrets in staged")
    return state["ok"]

def prune_file(abs_path, budget):
    text = read_text(abs_path)
    if text is None:
        return None
    before = est_tokens(text)
    if before <= budget:
        return {"before": before, "after": before, "moved": 0}
    lines = text.split("\n")
    kept, count = [], 0
    for l in lines:
        t = est_tokens(l + "\n")
        if len(kept) >= 10 and count + t > budget:
            break
        kept.append(l)
        count += t
    rest = lines[len(kept):]
    base, ext = os.path.splitext(abs_path)
    archive = base + ".archive.md"
    stamp = time.strftime("%Y-%m-%d", time.gmtime())
    try:
        with open(archive, "a", encoding="utf-8") as f:
            f.write(f"\n## pruned {stamp}\n\n" + "\n".join(rest) + "\n")
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write("\n".join(kept))
    except OSError:
        return None
    return {"before": before, "after": est_tokens("\n".join(kept)), "moved": len(rest)}

def cmd_optimize(args=None):
    root = self_root()
    if not root:
        missing_data("optimize")
        return False
    cwd = os.getcwd()
    opts = read_optimizations(cwd)
    mem = next((os.path.join(cwd, f) for f in ["MEMORY.md", os.path.join(".kiro", "MEMORY.md")]
                if os.path.exists(os.path.join(cwd, f))), None)
    if not mem:
        print("[harness] optimize - no MEMORY.md here (run harness init)")
    elif opts.get("prune-memory", True) is False:
        text = read_text(mem) or ""
        print(f"[harness] info - prune-memory off, MEMORY.md ~{fmt_tok(est_tokens(text))} (enable: harness optimizations enable prune-memory)")
    else:
        r = prune_file(mem, 2000)
        if not r:
            print("[harness] FAIL - optimize: could not prune MEMORY.md")
            return False
        if r["moved"] == 0:
            print(f"[harness] ok - memory ~{fmt_tok(r['before'])} - under 2k budget, nothing to do")
        else:
            print(f"[harness] ok - memory ~{fmt_tok(r['before'])} -> ~{fmt_tok(r['after'])}, {r['moved']} lines archived")
    if opts.get("archive-rotate", True) is not False and mem:
        base, _ext = os.path.splitext(mem)
        archive = base + ".archive.md"
        text = read_text(archive)
        if text is not None:
            lines = text.split("\n")
            if len(lines) > 500:
                trimmed = lines[len(lines) - 500:]
                try:
                    with open(archive, "w", encoding="utf-8") as f:
                        f.write("\n".join(trimmed))
                    print(f"[harness] ok - archive rotated: {len(lines)} -> {len(trimmed)} lines (oldest dropped)")
                except OSError:
                    print("[harness] warn - could not rotate archive")
    repaired = 0
    for h in list_hooks(root):
        abs_path = os.path.join(root, h)
        if not is_exec(abs_path):
            try:
                os.chmod(abs_path, 0o755)
                if is_exec(abs_path):
                    repaired += 1
            except OSError:
                pass
    if repaired:
        print(f"[harness] ok - repaired exec on {repaired} hooks")
    if opts.get("fast-hooks", True) is not False:
        times = {}
        for h in list_hooks(root):
            total = 0.0
            for _ in range(3):
                ms, _st = run_hook(os.path.join(root, h))
                total += ms
            times[h] = round(total / 3, 1)
        slow = slow_hooks(times, 2000)
        if slow:
            man_file = os.path.join(cwd, ".harness", "config.json")
            man = {"version": VERSION, "harness": [], "files": []}
            man_text = read_text(man_file)
            if man_text is not None:
                try:
                    man = json.loads(man_text)
                except ValueError:
                    pass
            disabled = set(man.get("disabledByPerf", []) or [])
            dropped = 0
            for h in slow:
                try:
                    os.chmod(os.path.join(root, h), 0o644)
                    disabled.add(h)
                    dropped += 1
                except OSError:
                    pass
            man["disabledByPerf"] = sorted(disabled)
            try:
                os.makedirs(os.path.dirname(man_file), exist_ok=True)
                with open(man_file, "w", encoding="utf-8") as f:
                    json.dump(man, f, indent=2)
            except OSError:
                print("[harness] warn - could not record disabled hooks")
            print(f"[harness] ok - fast-hooks: disabled {dropped} slow hook(s) over 2s mean: {', '.join(slow)} (re-enable: harness instinct enable <name>)")
    skills = list_skills(root)
    total = sum(s["tokens"] for s in skills)
    top = max(skills, key=lambda s: s["tokens"]) if skills else None
    extra = f", largest {top['name']} ~{fmt_tok(top['tokens'])}" if top else ""
    print(f"[harness] ok - skills {len(skills)} files ~{fmt_tok(total)} total{extra}")
    return True

def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def strip_fm(text):
    return re.sub(r"^---\n[\s\S]*?\n---\n", "", text, count=1)

def hook_blurb(root, rel):
    text = read_text(os.path.join(root, rel))
    if text is None:
        return rel
    for line in text.split("\n"):
        if line.startswith("# ") and not line.startswith("#!"):
            return line[2:]
    return rel

OPENCODE_PLUGIN = """// harness opencode plugin: wires .harness/hooks into tool events.
// guard blocks by throwing (opencode plugin pattern); check runs best-effort.
import { spawnSync } from "node:child_process";
import path from "node:path";

function runHook(directory, script, input) {
  const r = spawnSync("bash", [path.join(directory, ".harness", "hooks", script)], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    timeout: 10000,
    cwd: directory,
  });
  return typeof r.status === "number" ? r.status : 1;
}

export const HarnessPlugin = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    // opencode passes the command in the second arg (output.args); the first
    // arg carries only tool/session/call IDs.
    const args = (output && output.args) || {};
    const seen = { tool: input && input.tool, args };
    if (runHook(directory, "pre-tool--guard.sh", seen) === 2) {
      throw new Error("Blocked by harness guard (possible prompt injection or secret).");
    }
  },
  "tool.execute.after": async () => {
    runHook(directory, "post-edit--check.sh");
  },
});
"""

AUTO_MARKERS = {"claude": ".claude", "cursor": ".cursor", "opencode": "opencode.json",
                "codex": ".agents", "kiro-cli": ".kiro", "kiro-desktop": ".kiro",
                "aider": ".aider.conf.yml", "cline": ".clinerules", "generic": ""}

def cmd_init(args=None):
    root = self_root()
    if not root:
        missing_data("init")
        return False
    migrate = bool(getattr(args, "migrate", False))
    raw = getattr(args, "harness", "auto") or "auto"
    explicit = [s.strip() for s in raw.split(",") if s.strip()] if raw != "auto" else []
    adapters = [a for a in list_adapters(root) if a["json"]]
    by_name = {a["name"]: a for a in adapters}
    for c in list_adapters(os.getcwd(), os.path.join(".harness", "adapters")):
        if c["json"]:
            by_name[c["name"]] = c
    cwd = os.getcwd()
    man_file = os.path.join(cwd, ".harness", "config.json")
    prior = read_text(man_file)
    if prior is not None and not migrate:
        print("[harness] init - already initialized here (use --migrate to fill gaps)")
        return False
    prior_harness = []
    try:
        if prior is not None:
            prior_harness = [n for n in json.loads(prior).get("harness", []) if n in by_name]
    except (ValueError, AttributeError):
        pass
    if explicit:
        unknown = [n for n in explicit if n not in by_name]
        if unknown:
            print(f"[harness] init - unknown harness: {', '.join(unknown)} (try: harness adapter list)")
            return False
        names = explicit
    elif migrate and prior_harness:
        names = prior_harness
    else:
        names = [a["name"] for a in adapters
                 if (AUTO_MARKERS.get(a["name"], "") or "") and os.path.exists(os.path.join(os.getcwd(), AUTO_MARKERS[a["name"]]))]
    tracked = set()
    prior_files = []
    if prior is not None:
        try:
            prior_files = json.loads(prior).get("files", [])
            for f in prior_files:
                tracked.add(f if isinstance(f, str) else f.get("path", ""))
        except (ValueError, AttributeError):
            pass
    written, skipped = [], []
    def put(rel, content, exec=False, force=False):
        abs_path = os.path.join(cwd, rel)
        if not force and os.path.exists(abs_path):
            skipped.append(rel)
            return
        try:
            os.makedirs(os.path.dirname(abs_path) or ".", exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(content)
            if exec:
                os.chmod(abs_path, 0o755)
            written.append({"path": rel, "sha": sha256(content)})
        except OSError:
            print(f"[harness] init - could not write {rel}")
    agents_src = None
    if read_optimizations(cwd).get("slim-agents", True) is False:
        agents_src = read_text(os.path.join(root, "AGENTS.md"))
    else:
        agents_src = read_text(os.path.join(root, "templates", "AGENTS.project.md"))
        if agents_src is None:
            agents_src = read_text(os.path.join(root, "AGENTS.md"))
    mem_src = read_text(os.path.join(root, "memory", "MEMORY.md"))
    dests = {}
    if agents_src is not None:
        dests["AGENTS.md"] = agents_src
    if mem_src is not None:
        dests["MEMORY.md"] = mem_src
    for n in names:
        j = by_name[n]["json"]
        if j.get("memoryPath") and mem_src is not None:
            dests[j["memoryPath"]] = mem_src
        if j.get("agentsPath") and agents_src is not None:
            dests[j["agentsPath"]] = agents_src
    for rel, content in dests.items():
        put(rel, content)
    bodies = {}
    for s in list_skills(root):
        t = read_text(s["file"])
        if t is not None:
            bodies[s["name"]] = t
    hooks = list_hooks(root)
    for n in names:
        sp = by_name[n]["json"]["skillPath"]
        if not sp:
            print(f"[harness] init - {n}: fill in skillPath in its adapter.json first")
            continue
        if n == "cursor":
            for name, body in bodies.items():
                fm = parse_frontmatter(body)
                desc = re.sub(r"\s+", " ", fm["desc"] if fm else name)
                put(f"{sp}/{name}.mdc",
                    f"---\ndescription: {desc}\nalwaysApply: false\n---\n\n{strip_fm(body)}\n")
        elif n == "kiro-desktop":
            for name, body in bodies.items():
                fm = parse_frontmatter(body)
                desc = re.sub(r"\s+", " ", fm["desc"] if fm else name)
                put(f"{sp}/{name}.md",
                    f"---\ninclusion: auto\nname: {name}\ndescription: {desc}\n---\n\n{strip_fm(body)}\n")
        elif n == "cline":
            for name, body in bodies.items():
                put(f"{sp}/{name}.md", f"# {name}\n\n{strip_fm(body)}\n")
            lines = [f"- `{h}`: {hook_blurb(root, h)}" for h in hooks]
            put(f"{sp}/00-harness-instincts.md",
                "# Harness instincts\n\nThis project has no hooks system. Before finishing a task, run these checks yourself:\n\n"
                + "\n".join(lines) + "\n")
        elif sp.endswith(".md"):
            content = "\n\n---\n\n".join(f"# {name}\n\n{body}" for name, body in bodies.items()) + "\n"
            put(sp, content)
        else:
            for name, body in bodies.items():
                put(f"{sp}/{name}/SKILL.md", body)
    if "aider" in names:
        if not os.path.exists(os.path.join(cwd, ".aider.conf.yml")):
            put(".aider.conf.yml", "# written by harness init\nread: CONVENTIONS.md\n")
        elif ".aider.conf.yml" not in tracked:
            print("[harness] init - .aider.conf.yml exists, add read: CONVENTIONS.md manually")
    copied = []
    def copy_hook(rel):
        text = read_text(os.path.join(root, rel))
        if text is None:
            return
        base = os.path.basename(os.path.dirname(rel)) + "--" + os.path.basename(rel)
        put(os.path.join(".harness", "hooks", base), text, True)
        copied.append(base)
    for h in hooks:
        copy_hook(h)
    copy_hook(os.path.join("security", "audit.sh"))
    if "claude" in names:
        rel = os.path.join(".claude", "settings.json")
        if not os.path.exists(os.path.join(cwd, rel)):
            def entry(base, matcher, timeout):
                return {"matcher": matcher,
                        "hooks": [{"type": "command", "command": f"./.harness/hooks/{base}", "timeout": timeout}]}
            find = next((c for c in copied if c.endswith("session-start--hydrate.sh")), None)
            hj = {}
            if find:
                hj["SessionStart"] = [entry(find, "*", 15000)]
            find = next((c for c in copied if c.endswith("pre-tool--guard.sh")), None)
            if find:
                hj["PreToolUse"] = [entry(find, "Bash|Edit|Write", 5000)]
            find = next((c for c in copied if c.endswith("post-edit--check.sh")), None)
            if find:
                hj["PostToolUse"] = [entry(find, "Edit|Write", 5000)]
            find = next((c for c in copied if c.endswith("audit.sh")), None)
            if find:
                hj["PreCommit"] = [entry(find, "*", 10000)]
            put(rel, json.dumps({"hooks": hj}, indent=2) + "\n")
        elif rel.replace(os.sep, "/") not in tracked:
            print("[harness] init - .claude/settings.json exists, merge hooks manually (see docs/cli.md)")
    def find_hook(sfx):
        return next((c for c in copied if c.endswith(sfx)), None)
    if "cursor" in names:
        rel = os.path.join(".cursor", "hooks.json")
        if not os.path.exists(os.path.join(cwd, rel)):
            def centry(base, timeout):
                return {"command": f".harness/hooks/{base}", "timeout": timeout}
            ch = {}
            hyd = find_hook("session-start--hydrate.sh")
            grd = find_hook("pre-tool--guard.sh")
            chk = find_hook("post-edit--check.sh")
            if hyd:
                ch["sessionStart"] = [centry(hyd, 15)]
            if grd:
                ch["preToolUse"] = [centry(grd, 5)]
            if chk:
                ch["afterFileEdit"] = [centry(chk, 5)]
            put(rel, json.dumps({"version": 1, "hooks": ch}, indent=2) + "\n")
        elif rel.replace(os.sep, "/") not in tracked:
            print("[harness] init - .cursor/hooks.json exists, merge hooks manually (see docs/cli.md)")
    if "kiro-cli" in names or "kiro-desktop" in names:
        def kentry(nm, trigger, base, timeout):
            return {"name": nm, "trigger": trigger,
                    "action": {"type": "command", "command": f"./.harness/hooks/{base}"},
                    "timeout": timeout}
        hyd = find_hook("session-start--hydrate.sh")
        grd = find_hook("pre-tool--guard.sh")
        chk = find_hook("post-edit--check.sh")
        if hyd:
            put(os.path.join(".kiro", "hooks", "session-hydrate.json"), json.dumps({
                "version": "v1",
                "hooks": [
                    kentry("harness hydrate on session start", "SessionStart", hyd, 15),
                    kentry("harness hydrate on agent spawn", "Agent Spawn", hyd, 15),
                ]}, indent=2) + "\n")
        if grd:
            put(os.path.join(".kiro", "hooks", "pre-tool-guard.json"), json.dumps({
                "version": "v1",
                "hooks": [kentry("harness pre-tool guard", "Pre Tool Use", grd, 5)]}, indent=2) + "\n")
        if chk:
            put(os.path.join(".kiro", "hooks", "post-tool-check.json"), json.dumps({
                "version": "v1",
                "hooks": [kentry("harness post-edit check", "Post Tool Use", chk, 5)]}, indent=2) + "\n")
    if "opencode" in names:
        rel = os.path.join(".opencode", "plugins", "harness.js")
        if not os.path.exists(os.path.join(cwd, rel)):
            put(rel, OPENCODE_PLUGIN)
    if "codex" in names:
        rel = os.path.join(".codex", "hooks.json")
        if not os.path.exists(os.path.join(cwd, rel)):
            gitroot = '"$(git rev-parse --show-toplevel)"'
            def xentry(matcher, base, timeout):
                return {"matcher": matcher, "hooks": [{
                    "type": "command",
                    "command": f"bash {gitroot}/.harness/hooks/{base}",
                    "timeout": timeout}]}
            xh = {}
            hyd = find_hook("session-start--hydrate.sh")
            grd = find_hook("pre-tool--guard.sh")
            chk = find_hook("post-edit--check.sh")
            if hyd:
                xh["SessionStart"] = [xentry("startup|resume", hyd, 15)]
            if grd:
                xh["PreToolUse"] = [xentry("Bash", grd, 5)]
            if chk:
                xh["PostToolUse"] = [xentry("Bash", chk, 5)]
            put(rel, json.dumps({"hooks": xh}, indent=2) + "\n")
        elif rel.replace(os.sep, "/") not in tracked:
            print("[harness] init - .codex/hooks.json exists, merge hooks manually (see docs/cli.md); review new hooks with /hooks on first run")
    if read_optimizations(cwd).get("map-index", True) is not False:
        m = build_map(cwd)
        put(os.path.join(".harness", "MAP.md"), m["text"], False, True)
        print(f"[harness] init - map: {m['files']} files, ~{fmt_tok(m['tokens'])} tokens")
    files = list(prior_files) + written
    seen_paths = set()
    deduped = []
    for f in reversed(files):
        p = f if isinstance(f, str) else f.get("path", "")
        if p in seen_paths:
            continue
        seen_paths.add(p)
        deduped.append(f)
    files = list(reversed(deduped))
    prior_opts = {}
    if prior is not None:
        try:
            prior_opts = json.loads(prior).get("optimizations", {}) or {}
        except (ValueError, AttributeError):
            pass
    optimizations = dict(default_optimizations())
    for o in OPTIMIZATIONS:
        if isinstance(prior_opts.get(o["name"]), bool):
            optimizations[o["name"]] = prior_opts[o["name"]]
    try:
        os.makedirs(os.path.dirname(man_file), exist_ok=True)
        with open(man_file, "w", encoding="utf-8") as f:
            json.dump({"version": VERSION, "harness": names, "files": files,
                       "optimizations": optimizations,
                       "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f, indent=2)
    except OSError:
        print("[harness] init - could not write .harness/config.json")
        return False
    scope = ",".join(names) if names else "core only"
    print(f"[harness] init {scope} - {len(written)} written, {len(skipped)} skipped (run harness doctor to verify)")
    return True

UPGRADE_TARBALL = "https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/refs/heads/main"

def self_root():
    try:
        node = os.path.realpath(__file__)
        for _ in range(6):
            node = os.path.dirname(node)
            pkg = os.path.join(node, "pyproject.toml")
            if os.path.isfile(pkg):
                with open(pkg) as f:
                    if 'name = "agent-harness-cli"' in f.read():
                        return node
    except OSError:
        pass
    return None

def resolve_main_sha():
    try:
        req = Request("https://api.github.com/repos/TheElephantCoder/agent-harness/commits/main",
                      headers={"User-Agent": "agent-harness", "Accept": "application/vnd.github+json"})
        with urlopen(req, timeout=10) as res:
            if res.status != 200:
                return None
            sha = json.loads(res.read().decode("utf-8")).get("sha", "")
            return sha if len(sha) == 40 else None
    except Exception:
        return None

UPGRADE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

def plain_len(s):
    return len(re.sub(r"\x1b\[[0-9;]*m", "", s))

def use_upgrade_bar():
    if not sys.stdout.isatty() or os.environ.get("TERM") == "dumb":
        return False
    try:
        return shutil.get_terminal_size().columns >= 50
    except OSError:
        return False

def upgrade_bar(pct, stage, frame):
    try:
        width = shutil.get_terminal_size().columns
    except OSError:
        width = 80
    width = max(40, width)
    head = f"upgrade {frame} "
    tail = f" {round(pct)}% {stage}"
    bar_w = max(10, width - len(head) - len(tail) - 2)
    filled = min(bar_w, round(pct / 100 * bar_w))
    bar = paint(CYAN, "█" * filled) + paint(DIM, "░" * (bar_w - filled))
    return "\r" + head + "[" + bar + "]" + tail

def animated_run(cmd, stage):
    """run cmd with a creeping progress bar, return (returncode, output)."""
    state = {"frame": 0, "pct": 18.0, "stage": stage}
    def draw():
        sys.stdout.write(upgrade_bar(state["pct"], state["stage"], UPGRADE_FRAMES[state["frame"] % len(UPGRADE_FRAMES)]))
        sys.stdout.flush()
    sys.stdout.write("\x1b[?25l")
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        while p.poll() is None:
            draw()
            time.sleep(0.09)
            state["frame"] += 1
            state["pct"] = min(90.0, state["pct"] + (90 - state["pct"]) * 0.06 + 0.25)
        out = p.stdout.read() if p.stdout else ""
        return p.returncode, out
    except OSError:
        return 1, ""
    finally:
        sys.stdout.write("\x1b[?25h\n")
        sys.stdout.flush()

MAP_EXTS = {".ts", ".js", ".py", ".md", ".json", ".sh"}
MAP_SKIP_DIRS = {"node_modules", "dist", ".git", ".harness", "coverage"}

def map_symbols(text):
    out = []
    def push(s):
        if s and len(out) < 12 and s not in out:
            out.append(s)
    for line in text.split("\n"):
        m = re.match(r"^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)", line)
        if m:
            push(m.group(1) + "()")
            continue
        m = re.match(r"^\s*export\s+(?:const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_]+)", line)
        if m:
            push(m.group(1))
            continue
        if re.match(r"^\s*export\s+default\b", line):
            push("default")
            continue
        m = re.match(r"^(?:async\s+)?def\s+([A-Za-z0-9_]+)", line)
        if m:
            push(m.group(1) + "()")
            continue
        m = re.match(r"^class\s+([A-Za-z0-9_]+)", line)
        if m:
            push(m.group(1))
            continue
        m = re.match(r"^# (.+)", line)
        if m and not out:
            push(m.group(1)[:60])
    return out

def build_map(cwd):
    rows = []
    def walk(d):
        try:
            entries = sorted(os.listdir(d))
        except OSError:
            return
        for e in entries:
            if e.startswith("."):
                continue
            abs_path = os.path.join(d, e)
            try:
                is_dir = os.path.isdir(abs_path)
                size = os.path.getsize(abs_path)
            except OSError:
                continue
            if is_dir:
                if e in MAP_SKIP_DIRS:
                    continue
                walk(abs_path)
            elif os.path.splitext(e)[1] in MAP_EXTS and size <= 200000:
                text = read_text(abs_path)
                if text is not None:
                    rows.append({"rel": os.path.relpath(abs_path, cwd), "syms": map_symbols(text)})
    walk(cwd)
    dirs = {}
    for r in rows:
        d = os.path.dirname(r["rel"])
        dirs[d] = dirs.get(d, 0) + 1
    stamp = time.strftime("%Y-%m-%d", time.gmtime())
    out = ["# Repo map", "",
           f"Generated by `harness map` on {stamp}. File -> exported symbols, one line each.",
           "", "## Layout"]
    out += [f"- {(d if d not in ('', '.') else '.')}/: {n} files" for d, n in sorted(dirs.items())]
    out += ["", "## Files"]
    out += [f"- {r['rel']}" + (": " + ", ".join(r["syms"]) if r["syms"] else "") for r in rows]
    out += [""]
    text = "\n".join(out)
    return {"lines": len(out), "files": len(rows), "tokens": est_tokens(text), "text": text}

def cmd_map(args=None):
    cwd = os.getcwd()
    r = build_map(cwd)
    try:
        os.makedirs(os.path.join(cwd, ".harness"), exist_ok=True)
        with open(os.path.join(cwd, ".harness", "MAP.md"), "w", encoding="utf-8") as f:
            f.write(r["text"])
    except OSError:
        print("[harness] FAIL - map: could not write .harness/MAP.md")
        return False
    print(f"[harness] ok - map: {r['files']} files, {r['lines']} lines, ~{fmt_tok(r['tokens'])} tokens -> .harness/MAP.md")
    return True

OPTIMIZATIONS = [
    {"name": "slim-agents", "scope": "ram",
     "desc": "install slim AGENTS.md (~180 tok) instead of full (~490 tok)"},
    {"name": "prune-memory", "scope": "ram",
     "desc": "keep MEMORY.md within the 2k-token budget"},
    {"name": "map-index", "scope": "ram",
     "desc": "write .harness/MAP.md file index on init"},
    {"name": "fast-hooks", "scope": "cpu",
     "desc": "disable hooks averaging over 2s, measured in optimize"},
    {"name": "archive-rotate", "scope": "disk",
     "desc": "cap MEMORY.archive.md at 500 lines in optimize"},
]

def default_optimizations():
    return {o["name"]: True for o in OPTIMIZATIONS}

def read_optimizations(cwd):
    out = default_optimizations()
    try:
        text = read_text(os.path.join(cwd, ".harness", "config.json"))
        if text is None:
            return out
        saved = json.loads(text).get("optimizations", {})
        for o in OPTIMIZATIONS:
            if isinstance(saved.get(o["name"]), bool):
                out[o["name"]] = saved[o["name"]]
    except (ValueError, AttributeError):
        pass
    return out

def write_optimizations(cwd, patch):
    man_file = os.path.join(cwd, ".harness", "config.json")
    man = {"version": VERSION, "harness": [], "files": []}
    man_text = read_text(man_file)
    if man_text is not None:
        try:
            man = json.loads(man_text)
        except ValueError:
            print("[harness] FAIL - .harness/config.json corrupt")
            return False
    merged = dict(default_optimizations())
    prev = man.get("optimizations", {})
    if isinstance(prev, dict):
        merged.update(prev)
    merged.update(patch)
    man["optimizations"] = {o["name"]: merged.get(o["name"], True) is not False for o in OPTIMIZATIONS}
    try:
        os.makedirs(os.path.dirname(man_file), exist_ok=True)
        with open(man_file, "w", encoding="utf-8") as f:
            json.dump(man, f, indent=2)
    except OSError:
        print("[harness] FAIL - could not write .harness/config.json")
        return False
    return True

def read_disabled_by_perf(cwd):
    try:
        text = read_text(os.path.join(cwd, ".harness", "config.json"))
        if text is None:
            return set()
        lst = json.loads(text).get("disabledByPerf", [])
        return set(x for x in lst if isinstance(x, str)) if isinstance(lst, list) else set()
    except (ValueError, AttributeError):
        return set()

def slow_hooks(measurements, budget_ms):
    return sorted(n for n, ms in measurements.items() if ms > budget_ms)

def cmd_optimizations(args=None):
    args = args or []
    cwd = os.getcwd()
    sub = args[0] if args else ""
    if sub in ("", "list"):
        print("[harness] optimizations (all on by default):")
        opts = read_optimizations(cwd)
        for o in OPTIMIZATIONS:
            print(f"  {o['name']} [{o['scope']}] {'on' if opts[o['name']] else 'off'} - {o['desc']}")
        return True
    if sub not in ("enable", "disable"):
        print("[harness] optimizations - want [enable|disable] <name|all>")
        return False
    target = args[1] if len(args) > 1 else ""
    names = [o["name"] for o in OPTIMIZATIONS] if target == "all" else [o["name"] for o in OPTIMIZATIONS if o["name"] == target]
    if not names:
        print(f"[harness] optimizations - unknown name \"{target}\" (try: {', '.join(o['name'] for o in OPTIMIZATIONS)})")
        return False
    if not write_optimizations(cwd, {n: sub == "enable" for n in names}):
        return False
    print(f"[harness] ok - optimizations {sub}d: {', '.join(names)}")
    return True

def missing_data(cmd):
    here = os.path.realpath(__file__)
    if "site-packages" in here or "dist-packages" in here:
        print(f"[harness] {cmd} - pip installs ship the CLI only: run from a source checkout or npm install for project files (pip still handles upgrade)")
    else:
        print(f"[harness] {cmd} - cannot locate install")

def cmd_upgrade(args=None):
    root = self_root()
    if root and os.path.isdir(os.path.join(root, ".git")):
        print("[harness] source checkout - run: git pull")
        return True
    here = os.path.realpath(__file__)
    pipx_home = os.environ.get("PIPX_HOME", "")
    under_pipx = (os.sep + "pipx" + os.sep + "venvs" + os.sep in here) or (bool(pipx_home) and here.startswith(pipx_home))
    if under_pipx and shutil.which("pipx"):
        print("[harness] upgrade - reinstalling via pipx...")
        try:
            r = subprocess.run(["pipx", "reinstall", "agent-harness-cli"])
        except OSError:
            r = None
        if r is not None and r.returncode == 0:
            print("[harness] upgraded - takes effect on next run")
            return True
        print("[harness] upgrade failed - try: pipx reinstall agent-harness-cli")
        return False
    if sys.executable:
        if use_upgrade_bar():
            sys.stdout.write(upgrade_bar(4, "resolving main", UPGRADE_FRAMES[0]))
            sys.stdout.flush()
            sha = resolve_main_sha()
            url = f"https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/{sha}" if sha else UPGRADE_TARBALL
            code, out = animated_run(
                [sys.executable, "-m", "pip", "install", "--upgrade", "--force-reinstall", "--progress-bar", "off", url],
                f"reinstalling {sha[:7] if sha else 'latest'}",
            )
            if code == 0:
                print(upgrade_bar(100, "verifying", "●").lstrip("\r"))
                print("[harness] upgraded - takes effect on next run")
                return True
            tail = "\n".join(out.strip().split("\n")[-12:])
            if tail.strip():
                print(tail)
            print("[harness] upgrade failed. run one of:")
            print(f"  pipx install --force {UPGRADE_TARBALL}")
            print(f"  python3 -m pip install --upgrade --force-reinstall {UPGRADE_TARBALL}  (use a venv or pipx on PEP 668 systems)")
            return False
        sha = resolve_main_sha()
        url = f"https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/{sha}" if sha else UPGRADE_TARBALL
        print(f"[harness] upgrade - reinstalling {sha[:7] if sha else 'latest'} via pip...")
        try:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "--force-reinstall", url])
        except OSError:
            r = None
        if r is not None and r.returncode == 0:
            print("[harness] upgraded - takes effect on next run")
            return True
    print("[harness] automatic upgrade failed. run one of:")
    print(f"  pipx install --force {UPGRADE_TARBALL}")
    print(f"  python3 -m pip install --upgrade --force-reinstall {UPGRADE_TARBALL}  (use a venv or pipx on PEP 668 systems)")
    return False

def slugify(s):
    slug = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]
    return slug or "note"

def read_added_skills(cwd):
    man_text = read_text(os.path.join(cwd, ".harness", "config.json"))
    if man_text is None:
        return [], False
    try:
        added = json.loads(man_text).get("addedSkills", [])
        return added if isinstance(added, list) else [], False
    except ValueError:
        return [], True

def verify_added_skill(cwd, a):
    p = os.path.join(cwd, ".harness", "skills", str(a.get("name", "")), "SKILL.md")
    text = read_text(p)
    if text is None:
        return f"{a.get('name')} (missing)"
    if sha256(text) != a.get("sha256"):
        return f"{a.get('name')} (modified)"
    return None

def cmd_memory_sync(note):
    mem_file = os.path.join(os.getcwd(), "MEMORY.md")
    if read_text(mem_file) is None:
        print("[harness] memory - no MEMORY.md here (run harness init)")
        return False
    stamp = time.strftime("%Y-%m-%d", time.gmtime())
    try:
        with open(mem_file, "a", encoding="utf-8") as f:
            f.write(f"\n- ({stamp}) {note}\n")
    except OSError:
        print("[harness] FAIL - memory: could not write MEMORY.md")
        return False
    if read_optimizations(os.getcwd()).get("prune-memory", True) is False:
        t = est_tokens(read_text(mem_file) or "")
        print(f"[harness] ok - memory synced (~{fmt_tok(t)}, pruning off)")
        return True
    r = prune_file(mem_file, 2000)
    if not r:
        print("[harness] FAIL - memory: could not prune MEMORY.md")
        return False
    extra = f", {r['moved']} lines archived" if r["moved"] else ""
    print(f"[harness] ok - memory synced (~{fmt_tok(r['after'])}{extra})")
    return True

def cmd_security(sub, rest):
    root = self_root()
    if not root:
        missing_data("security")
        return False
    abs_path = os.path.join(root, "security", "audit.sh")
    if not os.path.isfile(abs_path):
        print("[harness] security - audit.sh missing from install")
        return False
    args = ["--staged"] + rest if sub == "scan" and "--staged" not in rest else rest
    try:
        r = subprocess.run(["bash", abs_path] + args, cwd=os.getcwd())
    except OSError:
        return False
    return r.returncode == 0

def cmd_research_list():
    d = os.path.join(os.getcwd(), "research", "findings")
    try:
        files = sorted(f for f in os.listdir(d) if f.endswith(".md"))
    except OSError:
        files = []
    if not files:
        print("[harness] research - no findings yet (capture one: harness research \"query\")")
        return True
    for f in files:
        text = read_text(os.path.join(d, f)) or ""
        title = next((l for l in text.split("\n") if l.startswith("# ")), f)
        print(f"  {f} - {title.lstrip('# ')}")
    return True

def cmd_research(query):
    query = (query or "").strip()
    if not query:
        print("[harness] research - give a query to capture")
        return False
    rel = os.path.join("research", "findings", slugify(query) + ".md")
    abs_path = os.path.join(os.getcwd(), rel)
    if os.path.exists(abs_path):
        print(f"[harness] research - {rel} exists already")
        return True
    stamp = time.strftime("%Y-%m-%d", time.gmtime())
    try:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(f"# Findings: {query}\n\nDate: {stamp}\nStatus: draft\nSources:\n\n- \n\n## Verdict\n\n\n")
    except OSError:
        print("[harness] FAIL - research: could not write finding")
        return False
    print(f"[harness] ok - research stub: {rel} (fill it in, then plan)")
    return True

def sanitize_skill_name(s):
    slug = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:64]
    return slug

def fetch_tarball(url, max_bytes=8 * 1024 * 1024):
    try:
        req = Request(url, headers={"User-Agent": "agent-harness"})
        with urlopen(req, timeout=15) as res:
            if res.status != 200 or "gzip" not in (res.headers.get("Content-Type") or ""):
                return None
            chunks, size = [], 0
            while True:
                c = res.read(65536)
                if not c:
                    break
                size += len(c)
                if size > max_bytes:
                    return None
                chunks.append(c)
            return b"".join(chunks)
    except Exception:
        return None

def fetch_text(url, max_bytes=256 * 1024):
    try:
        req = Request(url, headers={"User-Agent": "agent-harness"})
        with urlopen(req, timeout=15) as res:
            if res.status != 200:
                return None
            chunks, size = [], 0
            while True:
                c = res.read(65536)
                if not c:
                    break
                size += len(c)
                if size > max_bytes:
                    return None
                chunks.append(c)
            return b"".join(chunks).decode("utf-8")
    except Exception:
        return None

def extract_skill_body(buf):
    import io
    import tarfile
    try:
        tf = tarfile.open(fileobj=io.BytesIO(buf), mode="r:gz")
        names = tf.getnames()
    except (tarfile.TarError, OSError):
        return None
    top = names[0].split("/")[0] + "/" if names else ""
    cands = sorted(
        (n for n in names
         if n == top + "SKILL.md" or re.fullmatch(r"[^/]+/skills/[^/]+/SKILL\.md", n)),
        key=len,
    )
    body = None
    if cands:
        try:
            f = tf.extractfile(cands[0])
            body = f.read().decode("utf-8") if f else None
        except (KeyError, OSError, UnicodeDecodeError):
            body = None
    try:
        tf.close()
    except OSError:
        pass
    return body

def finish_skill_add(body, repo_label, ref):
    cwd = os.getcwd()
    fm = parse_frontmatter(body)
    if not fm:
        print(f"[harness] skill add - {repo_label} SKILL.md lacks name/description frontmatter")
        return False
    name = sanitize_skill_name(fm["name"])
    if not name:
        print("[harness] skill add - unusable skill name in frontmatter")
        return False
    rel = os.path.join(".harness", "skills", name, "SKILL.md")
    if os.path.exists(os.path.join(cwd, rel)):
        print(f"[harness] skill add - {rel} exists already")
        return False
    try:
        os.makedirs(os.path.join(cwd, ".harness", "skills", name), exist_ok=True)
        with open(os.path.join(cwd, rel), "w", encoding="utf-8") as f:
            f.write(body)
    except OSError:
        print(f"[harness] skill add - could not write {rel}")
        return False
    man_file = os.path.join(cwd, ".harness", "config.json")
    man = {"version": VERSION, "harness": [], "files": []}
    man_text = read_text(man_file)
    if man_text is not None:
        try:
            man = json.loads(man_text)
        except ValueError:
            print("[harness] skill add - .harness/config.json corrupt")
            return False
    added = man.get("addedSkills", [])
    added.append({"name": name, "repo": repo_label, "ref": ref,
                  "sha256": sha256(body), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    man["addedSkills"] = added
    try:
        os.makedirs(os.path.dirname(man_file), exist_ok=True)
        with open(man_file, "w", encoding="utf-8") as f:
            json.dump(man, f, indent=2)
    except OSError:
        print("[harness] skill add - could not update .harness/config.json")
        return False
    where = repo_label if ref == "-" else f"{repo_label}@{ref}"
    print(f"[harness] ok - skill {name} from {where} pinned in manifest")
    return True

def add_from_dir(d):
    abs_path = os.path.realpath(os.path.expanduser(d))
    if not os.path.isdir(abs_path):
        print(f"[harness] skill add - not a directory: {d}")
        return False
    cands = []
    direct = os.path.join(abs_path, "SKILL.md")
    if os.path.isfile(direct):
        cands.append(direct)
    skills_dir = os.path.join(abs_path, "skills")
    try:
        for e in sorted(os.listdir(skills_dir)):
            f = os.path.join(skills_dir, e, "SKILL.md")
            if os.path.isfile(f):
                cands.append(f)
    except OSError:
        pass
    if not cands:
        print(f"[harness] skill add - no SKILL.md in {d} (want SKILL.md at root or skills/<name>/SKILL.md)")
        return False
    body = read_text(cands[0])
    if body is None:
        print(f"[harness] skill add - cannot read {cands[0]}")
        return False
    return finish_skill_add(body, f"local:{abs_path}", "-")

def add_from_url(url):
    # codeload URLs carry tar.gz as a path segment (.../tar.gz/<ref>).
    path_part = re.split(r"[?#]", url)[0].lower()
    segs = set(path_part.split("/"))
    is_md = path_part.endswith(".md")
    is_tarball = not is_md and (
        "tar.gz" in segs or "tgz" in segs
        or path_part.endswith((".tar.gz", ".tgz", ".tar", ".gz"))
    )
    if not is_md and not is_tarball:
        print("[harness] skill add - want a .md file or .tar.gz archive URL (or owner/repo, or --path)")
        return False
    print(f"[harness] skill add - fetching {url}...")
    if is_md:
        body = fetch_text(url)
        if not body:
            print(f"[harness] skill add - could not fetch {url}")
            return False
        return finish_skill_add(body, url, "-")
    buf = fetch_tarball(url)
    if not buf:
        print(f"[harness] skill add - could not fetch {url}")
        return False
    body = extract_skill_body(buf)
    if not body:
        print(f"[harness] skill add - no SKILL.md in {url} (want SKILL.md at root or skills/<name>/SKILL.md)")
        return False
    return finish_skill_add(body, url, "-")

def cmd_skill_add(args):
    if args and args[0] == "--path":
        if len(args) < 2:
            print("[harness] skill add - usage: skill add --path <dir>")
            return False
        return add_from_dir(args[1])
    spec = (args[0] if args else "").strip()
    if re.match(r"https?://", spec):
        return add_from_url(spec)
    if spec.startswith((".", "/", "~")) or os.path.exists(spec):
        return add_from_dir(spec)
    m = re.fullmatch(r"([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_.\-/]+))?", spec or "")
    if not m:
        print("[harness] skill add - want owner/repo[@ref], an https URL, or --path <dir>")
        return False
    repo, given_ref = m.group(1), m.group(2)
    for ref in [given_ref] if given_ref else ["main", "master"]:
        url = f"https://codeload.github.com/{repo}/tar.gz/{ref}"
        print(f"[harness] skill add - fetching {repo}@{ref}...")
        buf = fetch_tarball(url)
        if not buf:
            continue
        body = extract_skill_body(buf)
        if not body:
            print(f"[harness] skill add - no SKILL.md in {repo}@{ref} (want SKILL.md at root or skills/<name>/SKILL.md)")
            return False
        return finish_skill_add(body, repo, ref)
    print(f"[harness] skill add - could not fetch {repo} (tried main, master)")
    return False

def cmd_skill_list():
    root = self_root()
    if not root:
        missing_data("skill")
        return False
    for s in list_skills(root):
        print(f"  {s['name']} - {s['desc'] or '(no description)'} (~{fmt_tok(s['tokens'])})")
    return True

def cmd_skill_search(q):
    q = (q or "").lower().strip()
    if not q:
        print("[harness] skill search - give a query")
        return False
    root = self_root()
    if not root:
        missing_data("skill")
        return False
    hits = [s for s in list_skills(root)
            if q in s["name"] or q in s["desc"].lower() or q in (read_text(s["file"]) or "").lower()]
    if not hits:
        print(f"[harness] skill search - no skills match \"{q}\"")
    for s in hits:
        print(f"  {s['name']} - {s['desc'] or '(no description)'}")
    return True

def cmd_skill_info(name):
    root = self_root()
    if not root:
        missing_data("skill")
        return False
    s = next((x for x in list_skills(root) if x["name"] == (name or "")), None)
    if not s:
        print("[harness] skill info - unknown skill (try: harness skill list)")
        return False
    text = read_text(s["file"])
    if text is None:
        print(f"[harness] skill info - cannot read {name}")
        return False
    print(text)
    return True

def cmd_memory_show():
    text = read_text(os.path.join(os.getcwd(), "MEMORY.md"))
    if text is None:
        print("[harness] memory - no MEMORY.md here (run harness init)")
    else:
        print(text)
    return True

def cmd_memory_edit():
    mem_file = os.path.join(os.getcwd(), "MEMORY.md")
    if not os.path.isfile(mem_file):
        print("[harness] memory - no MEMORY.md here (run harness init)")
        return False
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print(f"[harness] memory - no terminal, edit {mem_file} by hand")
        return False
    editor = shlex.split(os.environ.get("EDITOR") or os.environ.get("VISUAL") or "vi")
    try:
        r = subprocess.run(editor + [mem_file])
        return r.returncode == 0
    except OSError:
        print("[harness] memory - could not launch editor")
        return False

def cmd_instinct_list():
    root = self_root()
    if not root:
        missing_data("instinct")
        return False
    for h in list_hooks(root):
        print(f"  {h} {'exec' if is_exec(os.path.join(root, h)) else 'noexec'}")
    return True

def cmd_instinct_toggle(op, name):
    root = self_root()
    if not root:
        missing_data("instinct")
        return False
    if not name:
        print(f"[harness] instinct {op} - give a hook name")
        return False
    matched = [h for h in list_hooks(root) if name in h]
    if not matched:
        print(f"[harness] instinct - no hooks match \"{name}\"")
        return False
    done = 0
    for h in matched:
        try:
            os.chmod(os.path.join(root, h), 0o755 if op == "enable" else 0o644)
            done += 1
        except OSError:
            pass
    print(f"[harness] ok - instinct {op}d {done}/{len(matched)}")
    return done == len(matched)

def cmd_adapter_list():
    root = self_root()
    if not root:
        missing_data("adapter")
        return False
    packaged = list_adapters(root)
    packaged_names = {a["name"] for a in packaged}
    for a in packaged:
        extra = f" - {a['json']['displayName']}" if a["json"] and a["json"].get("displayName") else ""
        err = f" ({a['error']})" if a["error"] else ""
        print(f"  {a['name']}{extra}{err}")
    for a in list_adapters(os.getcwd(), os.path.join(".harness", "adapters")):
        if a["name"] in packaged_names:
            print(f"  {a['name']} (custom override)")
        else:
            err = f" ({a['error']})" if a["error"] else ""
            print(f"  {a['name']} (custom){err}")
    return True

def cmd_adapter_add(name):
    if not re.fullmatch(r"[a-z0-9-]+", name or ""):
        print("[harness] adapter add - want a lowercase-hyphen name")
        return False
    d = os.path.join(os.getcwd(), ".harness", "adapters", name)
    if os.path.exists(d):
        print(f"[harness] adapter add - {d} exists already")
        return False
    adapter_json = json.dumps({
        "name": name, "displayName": name, "skillPath": "",
        "hookPath": "", "memoryPath": "MEMORY.md", "agentsPath": "AGENTS.md",
        "transpile": "./transpile.sh",
        "notes": f"Fill in skillPath, then run: harness init --harness {name}",
    }, indent=2) + "\n"
    wrapper = ("#!/usr/bin/env bash\n"
               "# install this adapter's files into the current project.\n"
               "# delegates to harness init so there is one real implementation.\n"
               "set -euo pipefail\n"
               "if ! command -v harness >/dev/null 2>&1; then\n"
               f"  echo \"[{name}] harness not found - install it first\" >&2\n"
               "  exit 1\n"
               "fi\n"
               f"exec harness init --harness {name} --migrate\n")
    try:
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "adapter.json"), "w", encoding="utf-8") as f:
            f.write(adapter_json)
        with open(os.path.join(d, "transpile.sh"), "w", encoding="utf-8") as f:
            f.write(wrapper)
        os.chmod(os.path.join(d, "transpile.sh"), 0o755)
    except OSError:
        print(f"[harness] adapter add - could not scaffold {name}")
        return False
    print(f"[harness] ok - adapter {name} scaffolded (fill in skillPath, then: harness init --harness {name})")
    return True

def cmd_skill_remove(name):
    name = sanitize_skill_name(name or "")
    if not name:
        print("[harness] skill remove - give an added skill name")
        return False
    d = os.path.join(os.getcwd(), ".harness", "skills", name)
    if not os.path.isdir(d):
        print(f"[harness] skill remove - no added skill named \"{name}\" (built-ins live in the install, not here)")
        return False
    try:
        shutil.rmtree(d)
    except OSError:
        print(f"[harness] skill remove - could not remove {name}")
        return False
    man_file = os.path.join(os.getcwd(), ".harness", "config.json")
    man_text = read_text(man_file)
    if man_text is not None:
        try:
            man = json.loads(man_text)
            man["addedSkills"] = [a for a in man.get("addedSkills", []) if a.get("name") != name]
            with open(man_file, "w", encoding="utf-8") as f:
                json.dump(man, f, indent=2)
        except (ValueError, OSError):
            print("[harness] skill remove - manifest left stale, edit it by hand")
            return False
    print(f"[harness] ok - skill {name} removed")
    return True

def cmd_skill_verify(namesel):
    added, corrupt = read_added_skills(os.getcwd())
    if corrupt:
        print("[harness] FAIL - .harness/config.json corrupt")
        return False
    lst = [a for a in added if a.get("name") == namesel] if namesel else added
    if namesel and not lst:
        print(f"[harness] skill verify - no added skill named \"{namesel}\"")
        return False
    if not lst:
        print("[harness] skill verify - no added skills (add one with: harness skill add owner/repo)")
        return True
    bad = [r for r in (verify_added_skill(os.getcwd(), a) for a in lst) if r]
    if bad:
        print(f"[harness] FAIL - skills: {', '.join(bad)}")
        return False
    print(f"[harness] ok - {len(lst)} added skill(s) verified")
    return True

def launch_shell():
    print(welcome())
    show_menu()
    # history persists across sessions in .harness/history, but only in
    # initialized projects: creating .harness/ here would fake init state.
    hdir = os.path.join(os.getcwd(), ".harness")
    histfile = os.path.join(hdir, "history")
    try:
        import readline as rlmod
    except ImportError:
        rlmod = None
    if rlmod is not None and os.path.isdir(hdir):
        try:
            rlmod.read_history_file(histfile)
        except OSError:
            pass
        rlmod.set_history_length(100)
        atexit.register(rlmod.write_history_file, histfile)
    sh = HarnessShell()
    sh.intro = None
    print(paint(DIM, status_line()))
    sh.cmdloop()

class HarnessShell(cmdmod.Cmd):
    intro = None
    prompt = "harness> "
    _last = ""

    def preloop(self):
        self.prompt = f"{paint(BOLD + CYAN, 'harness>')} "

    def precmd(self, line):
        if line.strip() == "!!":
            if self._last:
                print(self._last)
                return self._last
            print("[harness] !! - no previous command")
            return ""
        return line

    def postcmd(self, stop, line):
        if line.strip():
            self._last = line.strip()
        return stop

    def do_clear(self, arg):
        "clear the screen"
        if sys.stdout.isatty():
            print("\x1b[2J\x1b[H", end="")

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
        parts = shlex.split(arg) if arg else []
        cmd_doctor(SimpleNamespace(fix="--fix" in parts, strict="--strict" in parts))

    def do_bench(self, arg):
        "run perf checks"
        parts = shlex.split(arg) if arg else []
        cmd_bench(SimpleNamespace(quick="--quick" in parts, compare="--compare" in parts))

    def do_optimize(self, arg):
        "prune memory, repair, report savings"
        cmd_optimize()

    def do_optimizations(self, arg):
        "list and toggle optimizations"
        parts = shlex.split(arg) if arg else []
        cmd_optimizations(parts)

    def do_adapter(self, arg):
        "list supported harnesses"
        parts = shlex.split(arg) if arg else []
        if parts and parts[0] == "add":
            cmd_adapter_add(parts[1] if len(parts) > 1 else "")
            return
        cmd_adapter_list()

    def do_skill(self, arg):
        "manage skills"
        parts = shlex.split(arg) if arg else []
        if parts and parts[0] == "add":
            cmd_skill_add(parts[1:])
            return
        if parts and parts[0] == "remove":
            cmd_skill_remove(parts[1] if len(parts) > 1 else "")
            return
        if parts and parts[0] == "verify":
            cmd_skill_verify(parts[1] if len(parts) > 1 else "")
            return
        if not parts or parts[0] == "list":
            cmd_skill_list()
            return
        if parts[0] == "search":
            cmd_skill_search(" ".join(parts[1:]))
            return
        if parts[0] == "info":
            cmd_skill_info(parts[1] if len(parts) > 1 else "")
            return
        print(f"[harness] skill {arg} - not implemented yet")

    def do_memory(self, arg):
        "manage memory"
        parts = shlex.split(arg) if arg else []
        if parts and parts[0] == "show":
            cmd_memory_show()
            return
        if parts and parts[0] == "prune":
            cmd_optimize()
            return
        if parts and parts[0] == "sync":
            cmd_memory_sync(" ".join(parts[1:]).strip())
            return
        if parts and parts[0] == "edit":
            cmd_memory_edit()
            return
        print(f"[harness] memory {arg} - not implemented yet")

    def do_instinct(self, arg):
        "manage hooks"
        parts = shlex.split(arg) if arg else []
        if not parts or parts[0] == "list":
            cmd_instinct_list()
            return
        if parts[0] in ("enable", "disable"):
            cmd_instinct_toggle(parts[0], parts[1] if len(parts) > 1 else "")
            return
        print(f"[harness] instinct {arg} - not implemented yet")

    def do_research(self, arg):
        "research-first capture"
        if not (arg or "").strip():
            cmd_research_list()
            return
        cmd_research(arg)

    def do_security(self, arg):
        "security checks"
        parts = shlex.split(arg) if arg else []
        sub = parts[0] if parts else "audit"
        if sub in ("audit", "scan"):
            cmd_security(sub, parts[1:])
        else:
            print(f"[harness] security {arg} - not implemented yet")

    def do_map(self, arg):
        "index repo to .harness/MAP.md"
        cmd_map()

    def do_upgrade(self, arg):
        "self-update to latest"
        cmd_upgrade()

    def do_status(self, arg):
        "project snapshot: memory, skills, hooks, last bench"
        cmd_status()

    @staticmethod
    def _parts(line):
        # str.split() drops trailing whitespace, but a trailing space means
        # the user is starting a new token: keep it as an empty last part.
        parts = line.split()
        if line.endswith((" ", "\t")):
            parts.append("")
        return parts

    def complete_skill(self, text, line, begidx, endidx):
        parts = self._parts(line)
        subs = ["list", "search", "info", "add", "remove", "verify"]
        if len(parts) <= 2:
            return [s for s in subs if s.startswith(text)]
        if len(parts) == 3 and parts[1] == "info":
            root = self_root()
            names = [s["name"] for s in list_skills(root)] if root else []
            return [n for n in names if n.startswith(text)]
        return []

    def complete_memory(self, text, line, begidx, endidx):
        return [s for s in ["show", "prune", "sync", "edit"] if s.startswith(text)]

    def complete_instinct(self, text, line, begidx, endidx):
        parts = self._parts(line)
        if len(parts) <= 2:
            return [s for s in ["list", "enable", "disable"] if s.startswith(text)]
        if len(parts) == 3 and parts[1] in ("enable", "disable"):
            root = self_root()
            names = list_hooks(root) if root else []
            return [n for n in names if text in n]
        return []

    def complete_adapter(self, text, line, begidx, endidx):
        return [s for s in ["list", "add"] if s.startswith(text)]

    def complete_security(self, text, line, begidx, endidx):
        words = ["audit", "scan", "--staged"]
        return [w for w in words if w.startswith(text)]

    def complete_optimizations(self, text, line, begidx, endidx):
        parts = self._parts(line)
        if len(parts) <= 2:
            return [s for s in ["enable", "disable"] if s.startswith(text)]
        if len(parts) == 3 and parts[1] in ("enable", "disable"):
            names = [o["name"] for o in OPTIMIZATIONS] + ["all"]
            return [n for n in names if n.startswith(text)]
        return []

    def complete_init(self, text, line, begidx, endidx):
        return [f for f in ["--auto", "--harness", "--migrate"] if f.startswith(text)]

    def complete_doctor(self, text, line, begidx, endidx):
        return [f for f in ["--fix", "--strict"] if f.startswith(text)]

    def complete_bench(self, text, line, begidx, endidx):
        return [f for f in ["--quick", "--compare"] if f.startswith(text)]

    def default(self, line):
        print(f"[harness] unknown command: {line.split()[0]}")

def main():
    p = argparse.ArgumentParser(prog="harness", description="harness - agent harness perf layer by TheElephantCoder",
                                epilog="shell extras: menu (picker again), clear, !! (repeat last command)")
    p.add_argument("--version", "-v", action="store_true")
    sub = p.add_subparsers(dest="cmd")

    a = sub.add_parser("init")
    a.add_argument("--harness", default="auto")
    a.add_argument("--auto", action="store_true")
    a.add_argument("--migrate", action="store_true")

    b = sub.add_parser("doctor")
    b.add_argument("--fix", action="store_true")
    b.add_argument("--strict", action="store_true")

    c = sub.add_parser("bench")
    c.add_argument("--harness")
    c.add_argument("--task")
    c.add_argument("--compare", action="store_true")
    c.add_argument("--quick", action="store_true")

    for name in ["skill", "memory", "instinct", "research", "security", "upgrade", "shell", "optimize", "optimizations", "adapter", "map", "status", "version"]:
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
    dispatch = {"init": cmd_init, "doctor": cmd_doctor, "bench": cmd_bench, "upgrade": cmd_upgrade,
                "optimize": cmd_optimize, "map": cmd_map}
    if args.cmd in dispatch:
        if not dispatch[args.cmd](args):
            sys.exit(1)
        return
    if args.cmd == "adapter" and args.args[:1] == ["add"]:
        if not cmd_adapter_add(args.args[1] if len(args.args) > 1 else ""):
            sys.exit(1)
        return
    if args.cmd == "adapter" and (not args.args or args.args == ["list"]):
        if not cmd_adapter_list():
            sys.exit(1)
        return
    if args.cmd == "skill" and args.args[:1] == ["add"]:
        if not cmd_skill_add(args.args[1:]):
            sys.exit(1)
        return
    if args.cmd == "skill" and args.args[:1] == ["remove"]:
        if not cmd_skill_remove(args.args[1] if len(args.args) > 1 else ""):
            sys.exit(1)
        return
    if args.cmd == "skill" and args.args[:1] == ["verify"]:
        if not cmd_skill_verify(args.args[1] if len(args.args) > 1 else ""):
            sys.exit(1)
        return
    if args.cmd == "skill" and (not args.args or args.args[:1] == ["list"]):
        if not cmd_skill_list():
            sys.exit(1)
        return
    if args.cmd == "skill" and args.args[:1] == ["search"]:
        if not cmd_skill_search(" ".join(args.args[1:])):
            sys.exit(1)
        return
    if args.cmd == "skill" and args.args[:1] == ["info"]:
        if not cmd_skill_info(args.args[1] if len(args.args) > 1 else ""):
            sys.exit(1)
        return
    if args.cmd == "memory" and args.args[:1] == ["show"]:
        cmd_memory_show()
        return
    if args.cmd == "memory" and args.args[:1] == ["prune"]:
        if not cmd_optimize():
            sys.exit(1)
        return
    if args.cmd == "memory" and args.args[:1] == ["sync"]:
        if not cmd_memory_sync(" ".join(args.args[1:]).strip()):
            sys.exit(1)
        return
    if args.cmd == "memory" and args.args[:1] == ["edit"]:
        if not cmd_memory_edit():
            sys.exit(1)
        return
    if args.cmd == "instinct" and (not args.args or args.args[:1] == ["list"]):
        if not cmd_instinct_list():
            sys.exit(1)
        return
    if args.cmd == "instinct" and args.args[:1] in (["enable"], ["disable"]):
        if not cmd_instinct_toggle(args.args[0], args.args[1] if len(args.args) > 1 else ""):
            sys.exit(1)
        return
    if args.cmd == "security" and (not args.args or args.args[:1] in (["audit"], ["scan"])):
        sub = args.args[0] if args.args else "audit"
        if not cmd_security(sub, (args.args or ["audit"])[1:]):
            sys.exit(1)
        return
    if args.cmd == "research":
        if not (args.args or []):
            cmd_research_list()
            return
        if not cmd_research(" ".join(args.args or [])):
            sys.exit(1)
        return
    if args.cmd == "optimizations":
        if not cmd_optimizations(list(args.args or [])):
            sys.exit(1)
        return
    if args.cmd == "status":
        if not cmd_status():
            sys.exit(1)
        return
    if args.cmd == "version":
        print(f"harness {VERSION}")
        return
    rest = " ".join(getattr(args, "args", []) or [])
    print(f"[harness] {args.cmd} {rest} - not implemented yet".rstrip())

if __name__ == "__main__":
    main()
