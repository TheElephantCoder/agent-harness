import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  completeLine,
  estTokens,
  fmtTok,
  mapSymbols,
  parseFrontmatter,
  slowHooks,
  pruneFile,
  sanitizeSkillName,
  sha256,
  slugify,
  stripFm,
} from "../src/harness/cli.js";

describe("completeLine", () => {
  it("completes command names", () => {
    expect(completeLine("st")).toEqual([["status"], "st"]);
    expect(completeLine("zzz")[0]).toContain("status");
  });
  it("completes subcommands and flags", () => {
    expect(completeLine("skill ")[0]).toEqual([
      "list",
      "search",
      "info",
      "add",
      "remove",
      "verify",
    ]);
    expect(completeLine("doctor --")).toEqual([["--fix", "--strict"], "--"]);
    expect(completeLine("optimizations enable ")[0]).toEqual([
      "slim-agents",
      "prune-memory",
      "map-index",
      "fast-hooks",
      "archive-rotate",
      "all",
    ]);
  });
  it("completes installed skill names", () => {
    const [all] = completeLine("skill info ");
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n && !n.includes(" "))).toBe(true);
    expect(completeLine("skill info re")).toEqual([["research-first"], "re"]);
  });
  it("completes hook paths by substring", () => {
    const [all] = completeLine("instinct enable ");
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((h) => h.endsWith(".sh"))).toBe(true);
  });
});

describe("parseFrontmatter", () => {
  it("parses name and description", () => {
    const fm = parseFrontmatter("---\nname: x\ndescription: y\n---\nbody");
    expect(fm).toEqual({ name: "x", desc: "y" });
  });
  it("rejects missing frontmatter", () => {
    expect(parseFrontmatter("no frontmatter")).toBeNull();
  });
  it("rejects missing description", () => {
    expect(parseFrontmatter("---\nname: x\n---\nbody")).toBeNull();
  });
});

describe("tokens", () => {
  it("estimates 4 chars per token", () => {
    expect(estTokens("a".repeat(8))).toBe(2);
  });
  it("formats thousands", () => {
    expect(fmtTok(999)).toBe("999");
    expect(fmtTok(1500)).toBe("1.5k");
  });
});

describe("stripFm", () => {
  it("removes leading frontmatter", () => {
    expect(stripFm("---\nname: x\n---\nbody")).toBe("body");
  });
  it("leaves plain text alone", () => {
    expect(stripFm("body")).toBe("body");
  });
});

describe("mapSymbols", () => {
  it("extracts exports", () => {
    expect(
      mapSymbols("export function foo() {}\nexport const bar = 1;\nexport default x;"),
    ).toEqual(["foo()", "bar", "default"]);
  });
  it("reads python defs and markdown titles", () => {
    expect(mapSymbols("def hello():\n  pass")).toEqual(["hello()"]);
    expect(mapSymbols("# Title\n\ntext")).toEqual(["Title"]);
  });
  it("caps at twelve", () => {
    const src = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    expect(mapSymbols(src)).toHaveLength(12);
  });
});

describe("slowHooks", () => {
  it("flags only hooks over budget, sorted", () => {
    expect(slowHooks({ a: 10, b: 2500, c: 2000, d: 2001 }, 2000)).toEqual([
      "b",
      "d",
    ]);
    expect(slowHooks({}, 2000)).toEqual([]);
  });
});

describe("slugify", () => {
  it("slugifies queries", () => {
    expect(slugify("Token Overhead?!")).toBe("token-overhead");
  });
  it("falls back on empty", () => {
    expect(slugify("!!!")).toBe("note");
  });
});

describe("sanitizeSkillName", () => {
  it("lowercases and hyphenates", () => {
    expect(sanitizeSkillName("My Skill!")).toBe("my-skill");
  });
});

describe("sha256", () => {
  it("hashes deterministically", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("pruneFile", () => {
  const big = Array.from(
    { length: 60 },
    (_, i) => `# line ${i} with filler words here`,
  ).join("\n");
  it("leaves small files alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    const f = path.join(dir, "MEMORY.md");
    fs.writeFileSync(f, "small");
    const r = pruneFile(f, 2000);
    expect(r?.moved).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("archives overflow past budget", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    const f = path.join(dir, "MEMORY.md");
    fs.writeFileSync(f, big);
    const before = estTokens(big);
    const r = pruneFile(f, 100);
    expect(r).not.toBeNull();
    expect(r!.before).toBe(before);
    expect(r!.moved).toBeGreaterThan(0);
    expect(r!.after).toBeLessThanOrEqual(100);
    expect(fs.existsSync(path.join(dir, "MEMORY.archive.md"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("returns null for missing files", () => {
    expect(pruneFile("/no/such/file.md", 100)).toBeNull();
  });
});
