# harness python shim, mirrors cli.ts
import argparse
import cmd as cmdmod
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from types import SimpleNamespace
from urllib.request import Request, urlopen

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

def list_adapters(root):
    try:
        entries = sorted(os.listdir(os.path.join(root, "adapters")))
    except OSError:
        return []
    out = []
    for e in entries:
        d = os.path.join(root, "adapters", e)
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

SECRET_PATTERNS = ["BEGIN PRIVATE KEY", "AKIA", "ghp_", "github_pat_", "xoxb-", "xoxa-", "xoxp-"]

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
            if any(p in l for p in SECRET_PATTERNS):
                if "AKIA" in l and not re.search(r"AKIA[0-9A-Z]{16}", l):
                    continue
                hits.append((fname, line))
    return hits

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
    noexec = [h for h in hooks if not is_exec(os.path.join(root, h))]
    if noexec:
        if fix:
            repaired = 0
            for h in noexec:
                try:
                    os.chmod(os.path.join(root, h), 0o755)
                    if is_exec(os.path.join(root, h)):
                        repaired += 1
                except OSError:
                    pass
            still = [h for h in hooks if not is_exec(os.path.join(root, h))]
            if not still:
                print(f"[harness] ok - hooks: repaired exec on {repaired}, {len(hooks)} executable")
            else:
                fail(f"[harness] FAIL - hooks not executable: {', '.join(still)}")
        else:
            fail(f"[harness] FAIL - hooks not executable (run --fix): {', '.join(noexec)}")
    elif not hooks:
        fail("[harness] FAIL - hooks: none found")
    else:
        print(f"[harness] ok - hooks: {len(hooks)} executable")
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
            missing = [f for f in files if not os.path.exists(os.path.join(os.getcwd(), f))]
            if missing:
                fail(f"[harness] FAIL - project init files missing: {', '.join(missing)}")
            else:
                print(f"[harness] ok - project: {len(files)}/{len(files)} init files present")
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
    mem = next((os.path.join(cwd, f) for f in ["MEMORY.md", os.path.join(".kiro", "MEMORY.md")]
                if os.path.exists(os.path.join(cwd, f))), None)
    if not mem:
        print("[harness] optimize - no MEMORY.md here (run harness init)")
    else:
        r = prune_file(mem, 2000)
        if not r:
            print("[harness] FAIL - optimize: could not prune MEMORY.md")
            return False
        if r["moved"] == 0:
            print(f"[harness] ok - memory ~{fmt_tok(r['before'])} - under 2k budget, nothing to do")
        else:
            print(f"[harness] ok - memory ~{fmt_tok(r['before'])} -> ~{fmt_tok(r['after'])}, {r['moved']} lines archived")
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
    skills = list_skills(root)
    total = sum(s["tokens"] for s in skills)
    top = max(skills, key=lambda s: s["tokens"]) if skills else None
    extra = f", largest {top['name']} ~{fmt_tok(top['tokens'])}" if top else ""
    print(f"[harness] ok - skills {len(skills)} files ~{fmt_tok(total)} total{extra}")
    return True

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
    if explicit:
        unknown = [n for n in explicit if n not in by_name]
        if unknown:
            print(f"[harness] init - unknown harness: {', '.join(unknown)} (try: harness adapter list)")
            return False
        names = explicit
    else:
        names = [a["name"] for a in adapters
                 if (AUTO_MARKERS.get(a["name"], "") or "") and os.path.exists(os.path.join(os.getcwd(), AUTO_MARKERS[a["name"]]))]
    cwd = os.getcwd()
    man_file = os.path.join(cwd, ".harness", "config.json")
    prior = read_text(man_file)
    if prior is not None and not migrate:
        print("[harness] init - already initialized here (use --migrate to fill gaps)")
        return False
    tracked = set()
    if prior is not None:
        try:
            tracked = set(json.loads(prior).get("files", []))
        except ValueError:
            pass
    written, skipped = [], []
    def put(rel, content, exec=False):
        abs_path = os.path.join(cwd, rel)
        if os.path.exists(abs_path):
            skipped.append(rel)
            return
        try:
            os.makedirs(os.path.dirname(abs_path) or ".", exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(content)
            if exec:
                os.chmod(abs_path, 0o755)
            written.append(rel)
        except OSError:
            print(f"[harness] init - could not write {rel}")
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
        if ".aider.conf.yml" not in tracked and not os.path.exists(os.path.join(cwd, ".aider.conf.yml")):
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
        if rel.replace(os.sep, "/") not in tracked and not os.path.exists(os.path.join(cwd, rel)):
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
    files = list(tracked) + written
    try:
        os.makedirs(os.path.dirname(man_file), exist_ok=True)
        with open(man_file, "w", encoding="utf-8") as f:
            json.dump({"version": VERSION, "harness": names, "files": files,
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
    return bool(sys.stdout.isatty()) and os.environ.get("TERM") != "dumb"

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
        parts = shlex.split(arg) if arg else []
        cmd_doctor(SimpleNamespace(fix="--fix" in parts, strict="--strict" in parts))

    def do_bench(self, arg):
        "run perf checks"
        parts = shlex.split(arg) if arg else []
        cmd_bench(SimpleNamespace(quick="--quick" in parts, compare="--compare" in parts))

    def do_optimize(self, arg):
        "prune memory, repair, report savings"
        cmd_optimize()

    def do_adapter(self, arg):
        "list supported harnesses"
        root = self_root()
        if not root:
            missing_data("adapter")
            return
        for a in list_adapters(root):
            extra = f" - {a['json']['displayName']}" if a["json"] and a["json"].get("displayName") else ""
            err = f" ({a['error']})" if a["error"] else ""
            print(f"  {a['name']}{extra}{err}")

    def do_skill(self, arg):
        "manage skills"
        parts = shlex.split(arg) if arg else []
        if parts and parts[0] == "list":
            root = self_root()
            if not root:
                missing_data("skill")
                return
            for s in list_skills(root):
                print(f"  {s['name']} - {s['desc'] or '(no description)'} (~{fmt_tok(s['tokens'])})")
            return
        print(f"[harness] skill {arg} - not implemented yet")

    def do_memory(self, arg):
        "manage memory"
        parts = shlex.split(arg) if arg else []
        if parts and parts[0] == "show":
            text = read_text(os.path.join(os.getcwd(), "MEMORY.md"))
            if text is None:
                print("[harness] memory - no MEMORY.md here (run harness init)")
            else:
                print(text)
            return
        if parts and parts[0] == "prune":
            cmd_optimize()
            return
        print(f"[harness] memory {arg} - not implemented yet")

    def do_instinct(self, arg):
        "manage hooks"
        parts = shlex.split(arg) if arg else []
        if parts and parts[0] == "list":
            root = self_root()
            if not root:
                missing_data("instinct")
                return
            for h in list_hooks(root):
                print(f"  {h} {'exec' if is_exec(os.path.join(root, h)) else 'noexec'}")
            return
        print(f"[harness] instinct {arg} - not implemented yet")

    def do_research(self, arg):
        "research-first capture"
        print(f"[harness] research {arg} - not implemented yet")

    def do_security(self, arg):
        "security checks"
        print(f"[harness] security {arg} - not implemented yet")

    def do_upgrade(self, arg):
        "self-update to latest"
        cmd_upgrade()

    def default(self, line):
        print(f"[harness] unknown command: {line.split()[0]}")

def main():
    p = argparse.ArgumentParser(prog="harness", description="harness - agent harness perf layer by TheElephantCoder")
    p.add_argument("--version", action="store_true")
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

    for name in ["skill", "memory", "instinct", "research", "security", "upgrade", "shell", "optimize", "adapter"]:
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
                "optimize": cmd_optimize}
    if args.cmd in dispatch:
        if not dispatch[args.cmd](args):
            sys.exit(1)
        return
    if args.cmd == "adapter" and (not args.args or args.args == ["list"]):
        root = self_root()
        if not root:
            missing_data("adapter")
            sys.exit(1)
            return
        for a in list_adapters(root):
            extra = f" - {a['json']['displayName']}" if a["json"] and a["json"].get("displayName") else ""
            err = f" ({a['error']})" if a["error"] else ""
            print(f"  {a['name']}{extra}{err}")
        return
    if args.cmd == "skill" and args.args[:1] == ["list"]:
        root = self_root()
        if not root:
            missing_data("skill")
            sys.exit(1)
            return
        for s in list_skills(root):
            print(f"  {s['name']} - {s['desc'] or '(no description)'} (~{fmt_tok(s['tokens'])})")
        return
    if args.cmd == "memory" and args.args[:1] == ["show"]:
        text = read_text(os.path.join(os.getcwd(), "MEMORY.md"))
        if text is None:
            print("[harness] memory - no MEMORY.md here (run harness init)")
        else:
            print(text)
        return
    if args.cmd == "memory" and args.args[:1] == ["prune"]:
        if not cmd_optimize():
            sys.exit(1)
        return
    if args.cmd == "instinct" and args.args[:1] == ["list"]:
        root = self_root()
        if not root:
            missing_data("instinct")
            sys.exit(1)
            return
        for h in list_hooks(root):
            print(f"  {h} {'exec' if is_exec(os.path.join(root, h)) else 'noexec'}")
        return
    rest = " ".join(getattr(args, "args", []) or [])
    print(f"[harness] {args.cmd} {rest} - not implemented yet".rstrip())

if __name__ == "__main__":
    main()
