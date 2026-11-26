"""Exercise the same project workflows through both shipped CLIs."""
from concurrent.futures import ThreadPoolExecutor
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


def test_force_preserves_unowned_files(harness, tmp_path):
    instructions = tmp_path / "AGENTS.md"
    instructions.write_text("Run the local routing tests.\n")
    harness("init")
    assert "= AGENTS.md" in harness("init", "--force", "--dry-run")
    harness("init", "--force")
    assert instructions.read_text() == "Run the local routing tests.\n"
    manifest = json.loads((tmp_path / ".harness/config.json").read_text())
    assert "AGENTS.md" not in [f["path"] for f in manifest["files"]]


def make_skill(tmp_path):
    source = tmp_path / "fixture"
    source.mkdir()
    (source / "SKILL.md").write_text("---\nname: routes\ndescription: Check local routes.\n---\nRun tests.\n")
    return str(source)


def test_migrate_retains_skill_registration(harness, tmp_path):
    harness("init")
    harness("skill", "add", "--path", make_skill(tmp_path))
    manifest = tmp_path / ".harness/config.json"
    state = json.loads(manifest.read_text())
    pins = state["addedSkills"]
    state["disabledByPerf"] = ["post-edit--check.sh"]
    manifest.write_text(json.dumps(state))
    for option in ("--migrate", "--force"):
        harness("init", option)
        harness("skill", "verify", "routes")
        updated = json.loads(manifest.read_text())
        assert updated["addedSkills"] == pins
        assert updated["disabledByPerf"] == state["disabledByPerf"]


def test_failed_adapter_install_can_resume(harness, tmp_path):
    collision = tmp_path / ".claude"
    collision.write_text("existing checkout file")
    assert "could not write" in harness("init", "--harness", "claude", status=1)
    assert collision.read_text() == "existing checkout file"
    assert "incomplete" in harness("doctor", "--strict", status=1)
    collision.unlink()
    harness("init")
    assert (collision / "settings.json").is_file()
    assert (collision / "skills/performance/SKILL.md").is_file()
    assert json.loads((tmp_path / ".harness/config.json").read_text())["harness"] == ["claude"]
    harness("doctor", "--strict")


def test_map_keeps_doctor_in_sync(harness, tmp_path):
    harness("init")
    (tmp_path / "routes.py").write_text("def match(): pass\n")
    harness("map")
    index = tmp_path / ".harness/MAP.md"
    assert "routes.py" in index.read_text()
    harness("doctor", "--strict")
    index.write_text("manual edit")
    assert "MAP.md" in harness("doctor", "--strict", status=1)


def test_failed_skill_add_can_retry(harness, tmp_path):
    harness("init")
    source = make_skill(tmp_path)
    manifest = tmp_path / ".harness/config.json"
    saved = manifest.read_bytes()
    target = tmp_path / ".harness/skills/routes/SKILL.md"
    for invalid in ("{", "null", '{"addedSkills":{}}'):
        manifest.write_text(invalid)
        harness("skill", "add", "--path", source, status=1)
        assert not target.exists()
        assert manifest.read_text() == invalid
    manifest.write_bytes(saved)
    harness("skill", "add", "--path", source)
    harness("skill", "verify", "routes")
    target.write_text("locally edited")
    harness("skill", "add", "--path", source, status=1)
    assert target.read_text() == "locally edited"


def test_remove_accepts_the_filename_shown_in_research_list(harness, tmp_path):
    harness("research", "Route table")
    harness("research", "Route table md")
    findings = tmp_path / "research/findings"
    assert "route-table.md" in harness("research")
    harness("research", "remove", "route-table.md")
    assert not (findings / "route-table.md").exists()
    harness("research", "remove", "route-table.md", status=1)
    assert (findings / "route-table-md.md").is_file()
    harness("research", "remove", "Route table md")
    assert not (findings / "route-table-md.md").exists()


def test_skill_update_repairs_a_stale_pin(harness, tmp_path):
    source = Path(make_skill(tmp_path))
    harness("skill", "add", "--path", str(source))
    updated = (source / "SKILL.md").read_text() + "Check the fallback route.\n"
    (source / "SKILL.md").write_text(updated)
    installed = tmp_path / ".harness/skills/routes/SKILL.md"
    installed.write_text(updated)
    harness("skill", "verify", "routes", status=1)
    harness("skill", "update", "routes")
    harness("skill", "verify", "routes")
    manifest = tmp_path / ".harness/config.json"
    saved = manifest.read_bytes()
    harness("skill", "update", "routes")
    assert manifest.read_bytes() == saved


def test_local_skill_update_finds_the_registered_name(harness, tmp_path):
    source = Path(make_skill(tmp_path))
    target = source / "skills/z-routing/SKILL.md"
    target.parent.mkdir(parents=True)
    (source / "SKILL.md").rename(target)
    harness("skill", "add", "--path", str(source))
    other = source / "skills/a-formatting/SKILL.md"
    other.parent.mkdir()
    other.write_text("---\nname: formatting\ndescription: Format a file.\n---\n")
    target.write_text(target.read_text() + "Cover the fallback route.\n")
    harness("skill", "update", "routes")
    assert (tmp_path / ".harness/skills/routes/SKILL.md").read_bytes() == target.read_bytes()
    harness("skill", "verify", "routes")
    target.unlink()
    harness("skill", "update", "routes", status=1)
    harness("skill", "verify", "routes")


def test_backup_preserves_bytes_and_reserves_its_filename(harness, tmp_path):
    memory = tmp_path / "MEMORY.md"
    original = b"# Memory\r\n\r\nKeep line endings.\r\n"
    memory.write_bytes(original)
    memory.chmod(0o600)
    harness("memory", "backup")
    first, = tmp_path.glob("MEMORY.backup.*.md")
    next_slot = first.with_name(first.stem + "-2.md")
    missing = tmp_path / "moved-backup.md"
    next_slot.symlink_to(missing)
    memory.write_bytes(original + b"New note.\r\n")
    harness("memory", "backup")
    assert first.read_bytes() == original
    assert not missing.exists()
    assert next_slot.is_symlink()
    assert first.with_name(first.stem + "-3.md").read_bytes() == memory.read_bytes()
    if os.name == "posix":
        assert first.stat().st_mode & 0o077 == 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        outputs = list(pool.map(lambda _: harness("memory", "backup"), range(4)))
    assert len(set(outputs)) == 4
    for number in range(4, 8):
        assert first.with_name(f"{first.stem}-{number}.md").read_bytes() == memory.read_bytes()


def test_invalid_custom_adapter_fails_before_writing_files(harness, tmp_path):
    harness("adapter", "add", "mytool")
    config = tmp_path / ".harness/adapters/mytool/adapter.json"
    valid = json.loads(config.read_text())
    valid["skillPath"] = ".mytool/skills"
    for field, value in (("skillPath", ["skills"]), ("memoryPath", 12), ("name", ["mytool"])):
        config.write_text(json.dumps({**valid, field: value}))
        listing = harness("adapter", "list")
        assert field in listing
        message = harness("init", "--harness", "mytool", status=1)
        assert "mytool" in message and field in message
        assert not (tmp_path / "AGENTS.md").exists()
        assert not (tmp_path / ".harness/config.json").exists()
    config.write_text(json.dumps(valid))
    harness("init", "--harness", "mytool")
    assert (tmp_path / ".mytool/skills/performance/SKILL.md").is_file()


def test_bench_compare_recovers_from_invalid_measurements(harness, tmp_path):
    baseline = tmp_path / ".harness/bench.json"
    baseline.parent.mkdir()
    for previous in ({"coldStartMs": "unknown"}, {"coldStartMs": 12, "hooks": []},
                     {"coldStartMs": 12, "skillTokens": False}):
        baseline.write_text(json.dumps(previous))
        report = harness("bench", "--quick", "--compare")
        assert "baseline corrupt" in report
        assert "compare cold-start" not in report
        assert isinstance(json.loads(baseline.read_text())["coldStartMs"], (int, float))
    baseline.write_text('{"coldStartMs":0}')
    assert "was 0" in harness("bench", "--quick", "--compare")


def test_bench_fails_when_baseline_cannot_be_saved(harness, tmp_path):
    destination = tmp_path / ".harness/bench.json"
    destination.mkdir(parents=True)
    assert "could not write" in harness("bench", "--quick", status=1)
    assert destination.is_dir()
    destination.rmdir()
    harness("bench", "--quick")
    assert "coldStartMs" in json.loads(destination.read_text())


def test_cost_skips_undecodable_input_without_losing_valid_rows(harness, tmp_path):
    (tmp_path / "invalid.bin").write_bytes(b"x" * 8192 + b"\xff")
    (tmp_path / "valid.md").write_text("A real replacement character: \ufffd")
    assert "1 binary" in harness("cost", "invalid.bin")
    report = harness("cost", "--all")
    assert "1 binary" in report and "valid.md" in report and "invalid.bin" not in report


def test_cost_skips_explicit_symlinks_just_like_directory_walks(harness, tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "text.md").write_text("ordinary text")
    (tmp_path / "linked-file").symlink_to(source / "text.md")
    (tmp_path / "linked-dir").symlink_to(source, target_is_directory=True)
    for link in ("linked-file", "linked-dir"):
        assert "nothing text-readable" in harness("cost", link)
    assert "text.md" in harness("cost", "source")


def test_cost_distinguishes_missing_targets_from_empty_directories(harness, tmp_path):
    assert "missing" in harness("cost", "missing.txt", status=1)
    (tmp_path / "empty").mkdir()
    assert "nothing text-readable" in harness("cost", "empty")
