import os
import sys

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
