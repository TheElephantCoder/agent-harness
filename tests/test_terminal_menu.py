"""Drive both entry points through the actual terminal input protocol."""
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time

import pytest


@pytest.mark.skipif(os.name != "posix", reason="requires a POSIX pseudo-terminal")
@pytest.mark.parametrize("frontend", ["node", "python"])
@pytest.mark.parametrize("columns, legacy", [(80, False), (60, True)])
def test_settings_click_toggle_and_restore(tmp_path, frontend, columns, legacy):
    import fcntl
    import pty
    import select
    import struct
    import termios

    root = Path(__file__).resolve().parents[1]
    cmd = (["node", str(root / "dist/harness/cli.js")] if frontend == "node"
           else [sys.executable, str(root / "src/harness/cli.py")])
    master, slave = pty.openpty()
    attributes = termios.tcgetattr(slave)
    env = dict(os.environ, TERM="xterm-256color")
    for name in ("NO_COLOR", "HARNESS_EMBEDDED_TERMINAL", "LINES", "COLUMNS"):
        env.pop(name, None)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, columns, 0, 0))
    proc = subprocess.Popen(cmd, cwd=tmp_path, stdin=slave, stdout=slave, stderr=slave, env=env)

    def read_until(marker):
        output = bytearray()
        deadline = time.monotonic() + 5
        # A PTY read can stop midway through the rendered menu.
        def ready():
            start = output.find(marker)
            return start >= 0 and (marker == b"bye." or b"\x1b[?2026l" in output[start:])

        while not ready() and time.monotonic() < deadline:
            if select.select([master], [], [], .1)[0]:
                output.extend(os.read(master, 65536))
        assert ready(), output[-500:]
        return output

    def position(screen, label, offset=0):
        rows = re.split(rb"\x1b\[(\d+);1H", screen)
        for y, row in zip(rows[1::2], rows[2::2]):
            visible = re.sub(rb"\x1b\[[0-9;]*m", b"", row).decode()
            if label in visible:
                return visible.index(label) + 1 + offset, int(y)
        pytest.fail(f"{label} is missing from the menu")

    def report(button, point, release=False):
        x, y = point
        if legacy:
            return b"\x1b[M" + bytes([32 + (3 if release else button), 32 + x, 32 + y])
        return f"\x1b[<{button};{x};{y}".encode() + (b"m" if release else b"M")

    def click(screen, label, offset=0):
        point = position(screen, label, offset)
        os.write(master, report(0, point) + report(0, point, release=True))

    try:
        home = read_until(b"Type to search")
        assert b"Set up this project" in home
        assert b"\x1b[?1049h" in home
        # A release over Settings after pressing outside must not toggle it.
        os.write(master, report(0, (1, 1)) + report(0, position(home, "Settings"), release=True))
        click(home, "Tools")
        tools = read_until(b"Skills")
        click(tools, "Skills", offset=10)  # padding belongs to the row
        submenu = read_until("‹ Back".encode())
        click(submenu, "‹ Back")
        home = read_until(b"Type to search")
        pointer = position(home, "Project status")
        os.write(master, report(65, pointer))
        read_until("▸ Check setup".encode())
        os.write(master, report(64, pointer))
        home = read_until("▸ Project status".encode())
        click(home, "Settings")
        settings_menu = read_until("‹ Back".encode())
        click(settings_menu, "slim-agents")
        toggled = read_until(b"[off]")
        settings = json.loads((tmp_path / ".harness/config.json").read_text())
        assert settings["optimizations"]["slim-agents"] is False
        click(toggled, "‹ Back")
        read_until(b"Type to search")
        os.write(master, b"\t")
        read_until(b"Skills")
        os.write(master, b"\x10")
        read_until(b"Type to filter")
        os.write(master, b"17\r")
        empty = read_until(b"No matching commands")
        assert b"Enter to open" not in empty[empty.index(b"No matching commands"):]
        click(empty, "Clear search")
        read_until(b"Set up this project")
        assert proc.poll() is None
        os.write(master, b"\x1b")
        read_until(b"Type to search")
        os.write(master, b"qui")
        read_until(b"Quit")
        os.write(master, b"\r")
        assert b"\x1b[?1049l" in read_until(b"bye.")
        assert proc.wait(timeout=3) == 0
        restored = termios.tcgetattr(slave)
        # BSD can set PENDIN while switching back to canonical input.
        kernel_pending = getattr(termios, "PENDIN", 0)
        restored[3] &= ~kernel_pending
        attributes[3] &= ~kernel_pending
        assert restored == attributes
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        os.close(master)
        os.close(slave)


@pytest.mark.parametrize("frontend", ["node", "python"])
def test_plain_menu_accepts_command_name_without_control_sequences(tmp_path, frontend):
    root = Path(__file__).resolve().parents[1]
    command = (["node", str(root / "dist/harness/cli.js")] if frontend == "node"
               else [sys.executable, str(root / "src/harness/cli.py")])
    result = subprocess.run([*command, "--plain"], input="quit\n", text=True,
                            cwd=tmp_path, capture_output=True, timeout=5, check=True)
    assert "Project status" in result.stdout
    assert "Command name" in result.stdout
    assert "bye." in result.stdout
    assert "\x1b" not in result.stdout
