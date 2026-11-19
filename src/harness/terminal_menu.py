"""Full-screen menu shared by the Node and Python frontends on POSIX terminals."""
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
ACTIVE = colors(255, 42)
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


def frame(title, options, details, index, size, version):
    width, height = max(1, size.columns), max(1, size.lines)
    cols = 2 if width >= 72 and len(options) > 8 else 1
    first = 5 if height >= 12 else 2 if height >= 5 else 0
    capacity = max(1, height - first - (4 if height >= 12 else 1))
    rows = min(capacity, math.ceil(len(options) / cols))
    start = index // (rows * cols) * rows * cols
    pad = min(3 if width >= 40 else 1, (width - 1) // 2)
    inner = max(1, width - 2 * pad)
    cell = inner // cols
    canvas = [BASE + " " * width for _ in range(height)]
    hits = {}
    def line(y, text, style=BASE):
        if 0 <= y < height:
            canvas[y] = BASE + " " * pad + style + fit(text, inner) + BASE + " " * pad
    if first:
        line(0, f"◢◣  agent-harness   /   v{version}")
        if first >= 5 and width >= 60:
            line(0, f"◢◣  agent-harness   /   v{version}     ·     {os.path.basename(os.getcwd()) or os.sep}")
    if first >= 5:
        line(2, title)
        line(3, "─" * inner, MUTED)
    elif first:
        line(1, title)
    for row in range(rows):
        parts = [BASE, " " * pad]
        for col in range(cols):
            i = start + col * rows + row
            if i >= len(options):
                break
            label = f"{'▸' if i == index else ' '} {i + 1:2}  {options[i]}"
            parts.extend([ACTIVE if i == index else BASE, fit(label, cell)])
            hits[row + first + 1, col] = i
        occupied = min(cols, len(options) - start - row)
        parts.extend([BASE, " " * (width - pad - occupied * cell)])
        canvas[row + first] = "".join(parts)
    if height >= 12:
        if index < len(details):
            for offset, part in enumerate(textwrap.wrap(details[index], inner)[:2]):
                line(height - 3 + offset, part, MUTED)
        else:
            line(height - 3, "─" * inner, MUTED)
    if height > 2:
        line(height - 1, "↑↓ move   Enter select   type a number   Esc back" if width >= 56 else "↑↓ move  Enter select  Esc back", MUTED)
    output = "".join(f"{CSI}{y};1H{line}" for y, line in enumerate(canvas, 1))
    return output, hits, pad, cell, rows


def pick(title, options, details=(), initial=0, version=""):
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    index = max(0, min(initial, len(options) - 1))
    last = None
    digits = ""
    deadline = 0
    try:
        tty.setraw(fd)
        sys.stdout.write(CSI + "?25l" + CSI + "?1000h" + CSI + "?1006h")
        while True:
            size = shutil.get_terminal_size()
            if last != (index, size):
                output, hits, pad, cell, rows = frame(title, options, details, index, size, version)
                sys.stdout.write(output)
                sys.stdout.flush()
                last = (index, size)
            wait = max(0, min(.15, deadline - time.monotonic())) if digits else .15
            if not select.select([fd], [], [], wait)[0]:
                if digits and time.monotonic() >= deadline:
                    return int(digits) - 1
                continue
            key = os.read(fd, 1)
            if key.isdigit():
                n = int(digits + key.decode())
                if 1 <= n <= len(options):
                    digits = str(n)
                    deadline = time.monotonic() + .45
                    if n * 10 > len(options):
                        return n - 1
                continue
            digits = ""
            if key == b"\x1b":
                seq = b""
                while len(seq) < 32 and select.select([fd], [], [], .05)[0]:
                    seq += os.read(fd, 1)
                    if len(seq) >= 2 and 64 <= seq[-1] <= 126:
                        break
                if not seq:
                    return -1
                mouse = re.fullmatch(rb"\[<0;(\d+);(\d+)m", seq)
                if mouse:
                    x, y = map(int, mouse.groups())
                    hit = hits.get((y, (x - pad - 1) // max(1, cell)))
                    if hit is not None:
                        return hit
                key = {b"[A": b"k", b"[B": b"j", b"[C": b"l", b"[D": b"h"}.get(seq, b"?")
            if key in (b"q", b"\x03", b"\x04", b""):
                return -1
            if key in (b"\r", b"\n"):
                return index
            step = {b"k": -1, b"j": 1, b"h": -rows, b"l": rows}.get(key, 0)
            index = (index + step) % len(options)
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
