"""Full-screen menu shared by the Node and Python frontends on POSIX terminals."""
import colorsys
import json
import math
import os
import re
import select
import shutil
import signal
import sys
import termios
import time
import textwrap
import tty
import unicodedata

CSI = "\x1b["
# Inverse truecolor keeps cells opaque on Ghostty glass as well as solid themes.
def colors(ink, paper):
    return f"{CSI}0;7;38;2;{paper};{paper};{paper};48;2;{ink};{ink};{ink}m"

BASE = colors(240, 0)
MUTED = colors(172, 0)
CLEAR = BASE + CSI + "H" + CSI + "2J"
ENTER = CSI + "?1049h" + CLEAR
LEAVE = CSI + "?1006l" + CSI + "?1000l" + CSI + "?25h" + CSI + "0m" + CSI + "?1049l"


def fit(text, width):
    out = []
    used = 0
    for c in text:
        if not c.isprintable():
            c = " "
        cells = 0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in ("F", "W") else 1
        if used + cells > width:
            break
        out.append(c)
        used += cells
    return "".join(out) + " " * (width - used)


# Original lowercase lettering, drawn on a half-cell grid. The ascenders,
# descender and clipped corners distinguish the silhouette at text resolution.
NAME = "agent-harness"
GLYPHS = {
    "a": (".....",".....",".###.","...##",".####","##.##","##.##",".####",".....","....."),
    "g": (".....",".....",".####","##.##","##.##","##.##",".####","...##","...##",".###."),
    "e": (".....",".....",".###.","##.##","#####","##...","##...",".####",".....","....."),
    "n": (".....",".....","####.","##.##","##.##","##.##","##.##","##.##",".....","....."),
    "t": (".##.",".##.","####",".##.",".##.",".##.",".##.","..##","....","...."),
    "-": ("...","...","...","...","###","###","...","...","...","..."),
    "h": ("##...","##...","####.","##.##","##.##","##.##","##.##","##.##",".....","....."),
    "r": ("....","....","####","##..","##..","##..","##..","##..","....","...."),
    "s": (".....",".....",".####","##...","####.",".####","...##","####.",".....","....."),
}


def lettering():
    pixels = [".".join(GLYPHS[c][y] for c in NAME) for y in range(10)]
    return tuple("".join(" ▀▄█"[(a == "#") + 2 * (b == "#")] for a, b in zip(upper, lower))
                 for upper, lower in zip(pixels[::2], pixels[1::2]))


WORDMARK = lettering()
PANEL = colors(215, 19)
FOCUS = colors(255, 47)
INTRO_SECONDS = 1.45



def ease(value):
    t = min(1.0, max(0.0, value))
    return t * t * (3 - 2 * t)


def intro_lines(mark, phase):
    """Open the lettering outward from the hyphen; settle displaced scanlines."""
    pivot = mark[0].find("-") if len(mark) == 1 else sum(len(GLYPHS[c][0]) + 1 for c in "agent") + 1
    reach = max(pivot, len(mark[0]) - pivot)
    fade = ease((phase - .50) / .45)
    # A continuous hue wave moves across the glyphs as they assemble.
    inks = []
    for x in range(len(mark[0])):
        hue = (x / len(mark[0]) - phase * 1.4) % 1
        channels = colorsys.hsv_to_rgb(hue, .78, 1)
        r, g, b = (round(c * 255 * (1 - fade) + 240 * fade) for c in channels)
        inks.append(f"{CSI}0;7;38;2;0;0;0;48;2;{r};{g};{b}m")
    lines = []
    for y, row in enumerate(mark):
        parts = []
        current = None
        for x, glyph in enumerate(row):
            arrival = abs(x - pivot) / reach * .42 + abs(y - 2) * .022
            travel = ease((phase - arrival) / .34)
            if travel == 0:
                glyph = " "
            elif len(mark) > 1 and travel < 1:
                # Two offset contour passes converge on each letter's face.
                source = y + round((1 - travel) * (2 if x < pivot else -2))
                glyph = mark[source][x] if 0 <= source < len(mark) else " "
            if glyph != " " and inks[x] != current:
                current = inks[x]
                parts.append(current)
            parts.append(glyph)
        lines.append("".join(parts))
    return lines


HOME = "What do you want to do?"
SECTIONS = ("Project", "Tools", "Application")
SECTION_ACTIONS = (
    ("Project status", "Check setup", "Set up this project", "Map this repo", "Run benchmark", "Optimize this project", "Settings"),
    ("Skills", "Memory", "Instincts", "Research", "Security", "Adapters"),
    ("Local models", "Web GUI", "Upgrade", "Quit"),
)


def section_actions(options, section):
    return [options.index(label) for label in SECTION_ACTIONS[section] if label in options]


def frame(title, options, details, index, size, version, phase=1.0, query="", palette=False, section=0):
    width, height = max(1, size.columns), max(1, size.lines)
    home = title == HOME
    landing = home and not (palette or query)
    inner = min(76 if landing else 62, max(1, width - (4 if width >= 8 else 0)))
    pad = (width - inner) // 2
    mark = WORDMARK if inner >= len(WORDMARK[0]) and height >= 16 else (NAME,)
    footer = 4 if height >= 14 else 1 if height >= 4 else 0
    header = 2 if height >= 6 else 0
    rows = min(len(options), 9, max(1, height - header - footer))
    top = max(0, (height - header - rows - footer) // 2)
    first = top + header
    start = min(max(0, index - rows + 1), len(options) - rows)
    canvas = [BASE + " " * width for _ in range(height)]
    hits = {}

    def line(y, text, style=BASE, centered=False):
        if 0 <= y < height:
            if centered:
                text = " " * max(0, (inner - len(text)) // 2) + text
            canvas[y] = BASE + " " * pad + style + fit(text, inner) + BASE + " " * (width - pad - inner)

    def status():
        project = os.path.basename(os.getcwd()) or os.sep
        release = f"v{version}"
        line(height - 1, fit(project, max(0, inner - len(release) - 1)) + " " + release, MUTED)

    if landing:
        sidebar = inner >= 66
        roomy = height >= 15
        brand = mark if height >= 22 else (NAME,)
        brand_height = len(brand) + 1 if roomy else 0
        tools_height = 3 if roomy else 1 if height >= 4 else 0
        heading_height = 2 if height >= 8 else 0
        available = max(1, height - brand_height - heading_height - tools_height)
        body = min(max(map(len, SECTION_ACTIONS)), available)
        top = max(0, (height - brand_height - heading_height - body - tools_height) // 2)
        first = top + brand_height + heading_height
        nav = 19 if sidebar else 0
        if brand_height:
            left = (width - len(brand[0])) // 2
            if left >= 0:
                shift = round((1 - ease((phase - .59) / .41)) * max(0, (height - len(brand)) // 2 - top))
                for y, letters in enumerate(brand if phase == 1 else intro_lines(brand, phase)):
                    canvas[top + shift + y] = BASE + " " * left + letters + BASE + " " * (width - left - len(brand[0]))
        if phase >= .84:
            if heading_height:
                if sidebar:
                    line(first-1, fit("  Workspace", nav) + "  " + SECTIONS[section] + " actions", MUTED)
                else:
                    line(first-2, "  " + SECTIONS[section] + " actions", MUTED)
                    tabs = [BASE, " " * pad]
                    offset = 0
                    for n, name in enumerate(SECTIONS):
                        label = ("›" if n == section else " ") + name + " "
                        if offset + len(label) > inner:
                            break
                        tabs.extend([FOCUS if n == section else BASE, label])
                        for x in range(offset, offset + len(label)):
                            hits[first, pad + x + 1] = ("section", n)
                        offset += len(label)
                    tabs.extend([BASE, " " * (width - pad - offset)])
                    canvas[first-1] = "".join(tabs)
            start = min(max(0, index - body + 1), max(0, len(options)-body))
            for row in range(body):
                parts = [BASE, " " * pad]
                if sidebar:
                    name = SECTIONS[row] if row < len(SECTIONS) else ""
                    selected = row == section
                    parts.extend([FOCUS if selected else BASE, fit(("› " if selected else "  ") + name, nav-2), BASE, "  "])
                    if name:
                        for x in range(nav-2):
                            hits[first+row+1, pad+x+1] = ("section", row)
                item = row + start
                selected = item == index
                label = ("▸ " if selected else "  ") + options[item] if item < len(options) else ""
                parts.extend([FOCUS if selected else PANEL, fit(label, inner-nav), BASE, " " * (width-pad-inner)])
                canvas[first+row] = "".join(parts)
                if item < len(options):
                    for x in range(nav, inner):
                        hits[first+row+1, pad+x+1] = item
            if tools_height:
                hint = "Tab section   ↑↓ move   Enter open   Type to search" if inner >= 51 else "Tab group   ↑↓ move   ↵ open" if inner >= 28 else "Tab group  ↵ open"
                line(first + body + (1 if roomy else 0), hint, MUTED)
            if roomy:
                status()
        return encode(canvas), hits, pad, inner, body

    if header:
        line(first - 2, "  " + ("Commands" if home else title), MUTED)
        line(first - 1, "┃  " + (query + "▏" if query else "Type to filter…"), PANEL)
    for row in range(rows):
        i = start + row
        line(first + row, ("┃  " if index == i else "   ") + options[i], FOCUS if index == i else PANEL)
        for x in range(pad + 1, pad + inner + 1):
            hits[first + row + 1, x] = i
    if footer:
        line(first + rows, "↑↓ move   Enter open   Esc back", MUTED)
    if footer >= 4:
        if index < len(details):
            for offset, part in enumerate(textwrap.wrap(details[index], inner)[:2]):
                line(first + rows + 1 + offset, part, BASE)
        status()
    return encode(canvas), hits, pad, inner, rows


def encode(canvas):
    return "".join(f"{CSI}{y};1H{content}" for y, content in enumerate(canvas, 1))


def pick(title, options, details=(), initial=0, version="", startup=False):
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    index = max(0, min(initial, len(options) - 1))
    last = None
    query = ""
    palette = False
    section = 0
    matches = section_actions(options, section) if title == HOME else list(range(len(options)))
    try:
        tty.setraw(fd)
        sys.stdout.write(CSI + "?25l" + CSI + "?1000h" + CSI + "?1006h")
        started = time.monotonic()
        animate = startup and not os.environ.get("HARNESS_REDUCED_MOTION")
        while True:
            size = shutil.get_terminal_size()
            phase = min(1.0, (time.monotonic() - started) / INTRO_SECONDS) if animate and size.columns >= len(NAME) + 4 and size.lines >= 8 else 1.0
            if last != (index, size, phase, query, palette, section):
                labels = [options[i] for i in matches] or ["No matching commands"]
                descriptions = [details[i] if i < len(details) else "" for i in matches]
                output, hits, pad, cell, rows = frame(title, labels, descriptions, index, size, version, phase, query, palette, section)
                sys.stdout.write(CSI + "?2026h" + output + CSI + "?2026l")
                sys.stdout.flush()
                last = (index, size, phase, query, palette, section)
            wait = .15
            if phase < 1:
                wait = 1 / 30
            if not select.select([fd], [], [], wait)[0]:
                continue
            if phase < 1:
                # Draw the ready menu, then process the waiting input normally.
                animate = False
                continue
            key = os.read(fd, 1)
            if title == HOME and key == b"\x10":
                palette = True
                matches = list(range(len(options)))
                index = 0
                continue
            if key in (b"\x7f", b"\x08") or (len(key) == 1 and 32 <= key[0] <= 126):
                query = query[:-1] if key in (b"\x7f", b"\x08") else (query + key.decode())[:80]
                matches = [i for i, label in enumerate(options) if query.casefold() in label.casefold()]
                index = 0
                palette = True
                continue
            if key == b"\x1b":
                seq = b""
                while len(seq) < 32 and select.select([fd], [], [], .05)[0]:
                    seq += os.read(fd, 1)
                    if len(seq) >= 2 and 64 <= seq[-1] <= 126:
                        break
                if not seq:
                    if query or (title == HOME and palette):
                        palette = False
                        query = ""
                        index = 0
                        matches = section_actions(options, section) if title == HOME else list(range(len(options)))
                        continue
                    return -1
                mouse = re.fullmatch(rb"\[<0;(\d+);(\d+)m", seq)
                if mouse:
                    x, y = map(int, mouse.groups())
                    hit = hits.get((y, x))
                    if isinstance(hit, tuple):
                        section = hit[1]
                        matches = section_actions(options, section)
                        index = 0
                    elif isinstance(hit, int) and matches:
                        return matches[hit]
                    continue
                key = {b"[A": b"k", b"[B": b"j", b"[C": b"l", b"[D": b"h", b"[Z": b"backtab"}.get(seq, b"?")
            if key in (b"\x03", b"\x04", b""):
                return -1
            if key in (b"\r", b"\n"):
                if matches:
                    return matches[index]
                continue
            if title == HOME and not palette and key in (b"\t", b"backtab", b"h", b"l"):
                section = (section + (1 if key in (b"\t", b"l") else -1)) % len(SECTIONS)
                matches = section_actions(options, section)
                index = 0
                continue
            step = {b"k": -1, b"j": 1, b"h": -rows, b"l": rows}.get(key, 0)
            if step:
                index = (index + step) % max(1, len(matches))
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)
        sys.stdout.write(CSI + "?1006l" + CSI + "?1000l" + CSI + "?25h" + CLEAR)
        sys.stdout.flush()


if __name__ == "__main__":
    def terminate(_signum, _frame):
        raise SystemExit(143)

    signal.signal(signal.SIGTERM, terminate)
    # Zero means Back; reserve 255 for unsupported inputs or startup failures.
    try:
        choice = pick(**json.loads(sys.argv[1]))
    except Exception:
        sys.exit(255)
    sys.exit(choice + 1)
