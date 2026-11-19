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
def test_settings_toggle_and_restore(tmp_path, frontend):
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
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
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

    try:
        home = read_until(b"Type to search")
        assert b"Set up this project" in home
        assert b"\x1b[?1049h" in home
        os.write(master, b"settings\r")
        read_until(b"slim-agents")
        os.write(master, b"\r")
        read_until(b"[off]")
        settings = json.loads((tmp_path / ".harness/config.json").read_text())
        assert settings["optimizations"]["slim-agents"] is False
        os.write(master, b"\x1b")
        read_until(b"Type to search")
        os.write(master, b"\t")
        read_until(b"Skills")
        os.write(master, b"\x10")
        read_until(b"Type to filter")
        os.write(master, b"17\r")
        read_until(b"No matching commands")
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
