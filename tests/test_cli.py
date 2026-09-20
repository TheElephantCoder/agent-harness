import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "harness"))

import cli


def test_parse_frontmatter_ok():
    assert cli.parse_frontmatter("---\nname: x\ndescription: y\n---\nbody") == {
        "name": "x",
        "desc": "y",
    }


def test_parse_frontmatter_missing():
    assert cli.parse_frontmatter("no frontmatter") is None
    assert cli.parse_frontmatter("---\nname: x\n---\nbody") is None


def test_tokens():
    assert cli.est_tokens("a" * 8) == 2
    assert cli.fmt_tok(999) == "999"
    assert cli.fmt_tok(1500) == "1.5k"


def test_strip_fm():
    assert cli.strip_fm("---\nname: x\n---\nbody") == "body"
    assert cli.strip_fm("body") == "body"


def test_map_symbols():
    assert cli.map_symbols("export function foo() {}\nexport const bar = 1;") == ["foo()", "bar"]
    assert cli.map_symbols("def hello():\n  pass") == ["hello()"]
    assert cli.map_symbols("# Title\n\ntext") == ["Title"]
    big = "\n".join(f"export const v{i} = {i};" for i in range(20))
    assert len(cli.map_symbols(big)) == 12


def test_slow_hooks():
    assert cli.slow_hooks({"a": 10, "b": 2500, "c": 2000, "d": 2001}, 2000) == ["b", "d"]
    assert cli.slow_hooks({}, 2000) == []


def test_slugify():
    assert cli.slugify("Token Overhead?!") == "token-overhead"
    assert cli.slugify("!!!") == "note"


def test_sanitize_skill_name():
    assert cli.sanitize_skill_name("My Skill!") == "my-skill"


def test_sha256():
    assert cli.sha256("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_prune_file(tmp_path):
    small = tmp_path / "MEMORY.md"
    small.write_text("small")
    r = cli.prune_file(str(small), 2000)
    assert r["moved"] == 0
    big = tmp_path / "BIG.md"
    big.write_text("\n".join(f"# line {i} with filler words here" for i in range(60)))
    before = cli.est_tokens(big.read_text())
    r = cli.prune_file(str(big), 100)
    assert r["before"] == before
    assert r["moved"] > 0
    assert r["after"] <= 100
    assert (tmp_path / "BIG.archive.md").exists()
    assert cli.prune_file(str(tmp_path / "nope.md"), 100) is None


def test_fmt_age():
    assert cli.fmt_age(datetime.now(timezone.utc).isoformat()) == "just now"
    assert cli.fmt_age("not-a-date") == "unknown age"
    assert cli.fmt_age(None) == "unknown age"


def test_complete_skill_subs():
    sh = cli.HarnessShell()
    assert sh.complete_skill("", "skill ", 6, 6) == ["list", "search", "info", "add", "remove", "verify"]
    names = sh.complete_skill("", "skill info ", 11, 11)
    assert len(names) > 0
    assert all(n and " " not in n for n in names)
    assert sh.complete_skill("re", "skill info re", 11, 13) == ["research-first"]


def test_complete_instinct_hooks():
    sh = cli.HarnessShell()
    assert sh.complete_instinct("", "instinct ", 9, 9) == ["list", "enable", "disable"]
    hooks = sh.complete_instinct("", "instinct enable ", 16, 16)
    assert len(hooks) > 0
    assert all(h.endswith(".sh") for h in hooks)


def test_complete_flags_and_toggles():
    sh = cli.HarnessShell()
    assert sh.complete_doctor("--", "doctor --", 7, 9) == ["--fix", "--strict"]
    assert sh.complete_bench("--", "bench --", 6, 8) == ["--quick", "--compare"]
    assert sh.complete_optimizations("", "optimizations enable ", 23, 23) == [
        "slim-agents", "prune-memory", "map-index", "fast-hooks", "archive-rotate", "all",
    ]


def test_banner_block():
    assert cli.paint_rainbow("abc") == "abc"
    wide = cli.banner_block(160)
    assert "___" in wide
    assert "agent-harness v" in cli.banner_block(40)
    assert "agent-harness v" in cli.banner_block(70)


def test_status_line(tmp_path):
    assert cli.status_line(str(tmp_path)) == "project: not initialized · no MEMORY.md · skills 4"
    (tmp_path / ".harness").mkdir()
    (tmp_path / ".harness" / "config.json").write_text("{}")
    (tmp_path / "MEMORY.md").write_text("12345678")
    assert cli.status_line(str(tmp_path)) == "project: initialized · MEMORY ~2 · skills 4"


def test_bang_repeat(capsys):
    sh = cli.HarnessShell()
    assert sh.precmd("!!") == ""
    assert "[harness] !! - no previous command" in capsys.readouterr().out
    sh.postcmd(False, "status")
    assert sh.precmd("!!") == "status"
    sh.postcmd(False, "status")
    assert sh._last == "status"


def test_do_clear():
    cli.HarnessShell().do_clear("")


def test_cmd_status_bare_dir(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert cli.cmd_status() is True
    out = capsys.readouterr().out
    assert "[harness] status" in out
    assert "initialized: no" in out
    assert "MEMORY.md: missing" in out
    assert "last benchmark: none yet" in out


def test_cmd_status_initialized(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".harness").mkdir()
    (tmp_path / ".harness" / "config.json").write_text("{}")
    (tmp_path / "MEMORY.md").write_text("hello world")
    fdir = tmp_path / "research" / "findings"
    fdir.mkdir(parents=True)
    (fdir / "a.md").write_text("# A")
    (fdir / "b.md").write_text("# B")
    (tmp_path / ".harness" / "bench.json").write_text(json.dumps({
        "ts": datetime.now(timezone.utc).isoformat(), "coldStartMs": 41.2,
    }))
    assert cli.cmd_status() is True
    out = capsys.readouterr().out
    assert "initialized: yes" in out
    assert "MEMORY.md: ~" in out
    assert "research findings: 2" in out
    assert "cold-start 41.2ms" in out
