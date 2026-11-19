import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("frontend", ["node", "python"])
@pytest.mark.parametrize("missing_install", [True, False])
def test_failed_doctor_emits_one_report(tmp_path, frontend, missing_install):
    source = ROOT / ("dist/harness/cli.js" if frontend == "node" else "src/harness/cli.py")
    if missing_install:
        entry = tmp_path / ("cli.mjs" if frontend == "node" else "cli.py")
        shutil.copyfile(source, entry)
    else:
        entry = source
        config = tmp_path / ".harness/config.json"
        config.parent.mkdir()
        config.write_text("{")
    command = "node" if frontend == "node" else sys.executable
    result = subprocess.run([command, str(entry), "doctor", "--json"], cwd=tmp_path,
                            text=True, capture_output=True, timeout=10)
    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert report["ok"] is False and report["failures"]


def test_unknown_command_points_to_help_on_stderr(tmp_path):
    result = subprocess.run(["node", str(ROOT / "dist/harness/cli.js"), "nonesuch"],
                            cwd=tmp_path, text=True, capture_output=True)
    assert result.returncode != 0
    assert result.stdout == ""
    assert "nonesuch" in result.stderr and "harness --help" in result.stderr
