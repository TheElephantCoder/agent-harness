"""Exercise the same project workflows through both shipped CLIs."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.fixture(params=["node", "python"])
def harness(request, tmp_path):
    root = Path(__file__).resolve().parents[1]
    command = (["node", str(root / "dist/harness/cli.js")] if request.param == "node"
               else [sys.executable, str(root / "src/harness/cli.py")])

    def run(*args, status=0):
        result = subprocess.run(
            [*command, *args], cwd=tmp_path, text=True, capture_output=True, timeout=20,
            env=dict(os.environ, NO_UPDATE_NOTIFIER="1"),
        )
        assert result.returncode == status, (args, result.stdout, result.stderr)
        return result.stdout

    return run


def test_force_preserves_synced_memory(harness, tmp_path):
    harness("init")
    harness("memory", "sync", "Use exact route matching")
    memory = tmp_path / "MEMORY.md"
    saved = memory.read_bytes()
    assert b"Use exact route matching" in saved
    harness("init", "--force")
    assert memory.read_bytes() == saved
    harness("doctor", "--strict")
    memory.unlink()
    harness("init", "--force")
    assert memory.is_file()
