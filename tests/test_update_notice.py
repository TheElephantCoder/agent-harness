"""Exercise discovery and activation without updating the installed copy."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from harness import update_notice


@pytest.mark.parametrize("version,expected", [("0.3.2", True), ("0.3.1", False), ("0.3.0", False), ("bad", False)])
def test_package_update_requires_newer_version(monkeypatch, version, expected):
    monkeypatch.setattr(update_notice, "fetch_text", lambda *_: json.dumps({"version": version}))
    assert update_notice.available("npm", "/opt/node_modules/@theelephantcoder/agent-harness", "0.3.1") is expected


@pytest.mark.skipif(os.name != "posix", reason="requires terminal mouse reporting")
@pytest.mark.parametrize("frontend,columns,key", [("node", 80, False), ("python", 44, True)])
def test_callout_installs_update_in_checkout(tmp_path, frontend, columns, key):
    import fcntl
    import pty
    import select
    import struct
    import termios

    def git(cwd, *args):
        return subprocess.check_output(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                                        "-c", "commit.gpgsign=false", *args], cwd=cwd, text=True).strip()

    # Local main is one commit behind the fixture's upstream.
    upstream = tmp_path / "upstream"
    upstream.mkdir()
    git(upstream, "init", "-b", "main")
    for name in ("package.json", "pyproject.toml", "dist/harness/cli.js", "src/harness/cli.py",
                 "src/harness/update_notice.py", "src/harness/terminal_menu.py"):
        target = upstream / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    git(upstream, "add", ".")
    git(upstream, "commit", "-qm", "first")
    checkout = tmp_path / "installation"
    git(tmp_path, "clone", "--quiet", str(upstream), str(checkout))
    git(checkout, "remote", "set-url", "origin", update_notice.UPSTREAM)
    git(checkout, "config", f"url.{upstream}.insteadOf", update_notice.UPSTREAM)
    (upstream / "release.txt").write_text("updated")
    git(upstream, "add", "release.txt")
    git(upstream, "commit", "-qm", "release")

    # Stub only the GitHub comparison. The picker, click, and git pull are real.
    (tmp_path / "sitecustomize.py").write_text(
        'import io, urllib.request\n'
        'class Response(io.BytesIO):\n    status = 200\n'
        'def compare(req, **kwargs):\n'
        '    assert "/compare/" in req.full_url\n'
        '    return Response(b\'{"status":"ahead"}\')\n'
        'urllib.request.urlopen = compare\n')
    env = dict(os.environ, PYTHONPATH=str(tmp_path), TERM="xterm-256color", HARNESS_REDUCED_MOTION="1")
    for name in ("NO_COLOR", "HARNESS_EMBEDDED_TERMINAL", "COLUMNS", "LINES"):
        env.pop(name, None)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, columns, 0, 0))
    cmd = (["node", str(checkout / "dist/harness/cli.js")] if frontend == "node"
           else [sys.executable, str(checkout / "src/harness/cli.py")])
    proc = subprocess.Popen(cmd, cwd=tmp_path, stdin=slave, stdout=slave, stderr=slave, env=env)

    def read_until(marker, complete=False):
        data = bytearray()
        end = time.monotonic() + 8
        while time.monotonic() < end:
            if select.select([master], [], [], .1)[0]:
                data.extend(os.read(master, 65536))
                pos = data.find(marker)
                if pos >= 0 and (not complete or b"\x1b[?2026l" in data[pos:]):
                    return bytes(data)
        pytest.fail(f"Missing {marker!r} from terminal output: {data[-400:]!r}")

    try:
        screen = read_until(b"Update available", complete=True)
        assert not (checkout / "release.txt").exists()
        if key:
            os.write(master, b"\x15")
        else:
            for y, row in re.findall(rb"\x1b\[(\d+);1H(.*?)(?=\x1b\[\d+;1H|$)", screen, re.S):
                visible = re.sub(rb"\x1b\[[0-9;]*m", b"", row).decode()
                if "Click to update" in visible:
                    x = visible.index("Click to update") + 1
                    pos = f"\x1b[<0;{x};{int(y)}".encode()
                    os.write(master, pos + b"M" + pos + b"m")
                    break
            else:
                pytest.fail("Update button was missing")
        read_until(b"Press Enter to return")
        assert (checkout / "release.txt").read_text() == "updated"
        os.write(master, b"\r")
        home = read_until(b"Project status", complete=True)
        assert b"Update available" not in home
        os.write(master, b"\x03")
        assert proc.wait(timeout=4) == 0
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        os.close(master)
        os.close(slave)


def test_offline_package_check(monkeypatch):
    monkeypatch.setattr(update_notice, "fetch_text", lambda *_: None)
    assert not update_notice.available("npm", "/opt/node_modules/@theelephantcoder/agent-harness", "0.3.1")


@pytest.mark.parametrize("status", ["identical", "behind", "diverged"])
def test_source_callout_requires_fast_forward(tmp_path, monkeypatch, status):
    (tmp_path / ".git").mkdir()
    monkeypatch.setattr(update_notice, "official_main", lambda _: True)
    monkeypatch.setattr(update_notice, "git", lambda *_: "a" * 40)
    monkeypatch.setattr(update_notice, "fetch_text", lambda *_: json.dumps({"status": status}))
    assert not update_notice.available("npm", tmp_path, "0.3.1")


def test_dirty_checkout_stays_untouched(tmp_path):
    subprocess.run(["git", "init", "-b", "main", str(tmp_path)], check=True)
    subprocess.run(["git", "remote", "add", "origin", update_notice.UPSTREAM], cwd=tmp_path, check=True)
    local = tmp_path / "edit"
    local.write_text("local work")
    subprocess.run(["git", "add", "edit"], cwd=tmp_path, check=True)
    assert not update_notice.update_checkout(tmp_path)
    assert local.read_text() == "local work"
