import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "harness"))

import cli


def test_cmp_versions():
    assert cli.cmp_versions("0.2.1", "0.2.1") == 0
    assert cli.cmp_versions("0.2.0", "0.2.1") == -1
    assert cli.cmp_versions("0.10.0", "0.2.1") == 1
    assert cli.cmp_versions("1.0", "1.0.1") == -1


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
    # file ending right at the closing fence still strips
    assert cli.strip_fm("---\nname: x\ndescription: y\n---") == ""


def test_parse_frontmatter_eof_fence():
    assert cli.parse_frontmatter("---\nname: x\ndescription: y\n---") == {
        "name": "x",
        "desc": "y",
    }


def test_read_added_skills_shapes():
    import tempfile

    with tempfile.TemporaryDirectory() as d:
        man = os.path.join(d, ".harness")
        os.makedirs(man)
        with open(os.path.join(man, "config.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"addedSkills": ["just-a-string"]}))
        added, corrupt = cli.read_added_skills(d)
        assert added == [] and corrupt
        with open(os.path.join(man, "config.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"addedSkills": [{"name": "k", "sha256": "v"}]}))
        added, corrupt = cli.read_added_skills(d)
        assert not corrupt and added[0]["name"] == "k"


def test_scan_staged_hunk_lines(monkeypatch):
    import subprocess
    import tempfile

    diff = "\n".join([
        "diff --git a/a.md b/a.md",
        "index 1111111..2222222 100644",
        "--- a/a.md",
        "+++ b/a.md",
        "@@ -10,4 +10,5 @@ header",
        " context keeps numbering",
        "+ghp_" + "A" * 25,
        " more context",
        "+another line",
    ]) + "\n"

    class R:
        stdout = diff
        returncode = 0

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: R())
    hits = cli.scan_staged()
    assert hits == [("a.md", 11)]


def test_secret_patterns_shape():
    line = "// the ghp_ prefix will be generated later"
    assert not any(p.search(line) for p in cli.SECRET_RE)
    assert any(p.search("token ghp_" + "x" * 30 + " end") for p in cli.SECRET_RE)
    aws_example = "AKIAIOS" + "FODNN7EXAMPLE"
    assert any(p.search(aws_example) for p in cli.SECRET_RE)
    assert not any(p.search("AKIA short") for p in cli.SECRET_RE)


def test_cost_rows(tmp_path):
    (tmp_path / "big.md").write_text("x" * 400)  # 100 tokens
    (tmp_path / "small.toml").write_text("y" * 80)  # 20 tokens
    (tmp_path / "bin.dat").write_bytes(b"a\x00b")
    (tmp_path / ".hidden").write_text("z" * 40)
    nm = tmp_path / "node_modules"
    nm.mkdir()
    (nm / "dep.md").write_text("d" * 40)
    (tmp_path / "huge.log").write_text("a" * (600 * 1024))
    r = cli.cost_rows(str(tmp_path), ".", all=False)
    assert [row["rel"] for row in r["rows"]] == ["big.md", "small.toml"]
    assert r["total"] == 120
    assert r["binary"] == 1
    assert r["large"] == 1
    one = cli.cost_rows(str(tmp_path), "big.md")
    assert len(one["rows"]) == 1 and one["total"] == 100


def test_cost_rows_cap(tmp_path):
    for i in range(15):
        (tmp_path / f"f{i}.md").write_text("x" * 40)
    capped = cli.cost_rows(str(tmp_path), ".")
    assert capped["shown"] == 12 and len(capped["rows"]) == 15
    everything = cli.cost_rows(str(tmp_path), ".", all=True)
    assert everything["shown"] == 15


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


def test_welcome():
    for w in (40, 80, 160, 300):
        text = cli.welcome(w)
        assert "agent-harness" in text
        assert "|___/" not in text
        assert "█████" not in text


def test_every_window_size():
    ansi = re.compile(r"\x1b\[[0-9;]*m")
    for w in range(21, 301):
        for line in ansi.sub("", cli.welcome(w)).split("\n"):
            assert len(line) <= w, (w, line)


def test_ollama_helpers():
    assert cli.fmt_mem(1024) == "1MB"
    assert cli.fmt_mem(1135821) == "1.1GB"
    assert cli.fmt_mem(round(2.6 * 1024 * 1024)) == "2.6GB"
    rows = cli.parse_ollama_ps(
        '{"models": [{"name": "qwen2.5-coder:1.5b", "size_vram": 1163080498}, {"name": "x", "size": 1000}]}'
    )
    assert rows == [{"name": "qwen2.5-coder:1.5b", "sizeKb": 1135821},
                    {"name": "x", "sizeKb": 1}]
    assert cli.parse_ollama_ps("nope") == []
    assert cli.parse_ollama_ps('{"models": {}}') == []


def test_bench_quick_smoke(tmp_path, monkeypatch):
    # exercises the full bench path incl. run_hook (regression: NameError)
    import types
    monkeypatch.chdir(tmp_path)
    assert cli.cmd_bench(types.SimpleNamespace(quick=True, compare=False)) is True
    assert (tmp_path / ".harness" / "bench.json").exists()


def test_optimize_smoke(tmp_path, monkeypatch):
    # exercises the full optimize path incl. unload (no runners: no-op)
    monkeypatch.chdir(tmp_path)
    assert cli.cmd_optimize() is True


def test_build_map_caps_and_cycles(tmp_path):
    import signal
    for i in range(cli.MAP_MAX_FILES + 50):
        (tmp_path / f"m{i}.ts").write_text("export const x = 1;\n")
    r = cli.build_map(str(tmp_path))
    assert r["files"] == cli.MAP_MAX_FILES
    assert r["omitted"] == 50
    assert "more files omitted (grep the repo)" in r["text"]
    cyc = tmp_path / "cyc"
    cyc.mkdir()
    os.symlink(str(tmp_path), str(cyc / "up"))

    def _timeout(_signum, _frame):
        raise TimeoutError("build_map hung on symlink cycle")

    old = signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(20)
    try:
        r2 = cli.build_map(str(tmp_path))
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)
    assert r2["files"] == cli.MAP_MAX_FILES
    assert r2["omitted"] == 50


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
