import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MAP_MAX_FILES,
  buildMap,
  cmpVersions,
  estTokens,
  fmtMem,
  haveBin,
  parseOllamaPs,
  startGuiServer,
  fmtTok,
  mapSymbols,
  parseFrontmatter,
  slowHooks,
  pruneFile,
  sanitizeSkillName,
  sha256,
  slugify,
  stripFm,
  welcome,
} from "../src/harness/cli.js";

describe("cmpVersions", () => {
  it("compares dotted versions numerically", () => {
    expect(cmpVersions("0.2.1", "0.2.1")).toBe(0);
    expect(cmpVersions("0.2.0", "0.2.1")).toBe(-1);
    expect(cmpVersions("0.10.0", "0.2.1")).toBe(1);
    expect(cmpVersions("1.0", "1.0.1")).toBe(-1);
  });
});

describe("gui server", () => {
  it("serves status, runs commands, rejects bad input", async () => {
    const { server, port } = await startGuiServer(0);
    try {
      const base = `http://127.0.0.1:${port}`;
      const status = await (await fetch(`${base}/api/status`)).json();
      expect(status.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(typeof status.cwd).toBe("string");
      expect(typeof status.project).toBe("object");
      expect(typeof status.project.skills).toBe("number");
      const upd = await (await fetch(`${base}/api/update-info`)).json();
      expect(upd.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(typeof upd.node).toBe("string");
      if (upd.commit !== null) expect(upd.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof upd.sys).toBe("object");
      expect(typeof upd.license).toBe("object");
      const upd2 = await (await fetch(`${base}/api/update-info`)).json();
      expect(upd2.latest).toEqual(upd.latest);
      expect(upd2.commit).toEqual(upd.commit);
      const run = await (
        await fetch(`${base}/api/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "version", args: [] }),
        })
      ).json();
      expect(run.ok).toBe(true);
      expect(run.output).toContain("harness");
      const blocked = await (
        await fetch(`${base}/api/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "upgrade", args: [] }),
        })
      ).json();
      expect(blocked.ok).toBe(false);
      const noAgent = await (
        await fetch(`${base}/api/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: "nope", prompt: "hi" }),
        })
      ).json();
      expect(noAgent.ok).toBe(false);
      const started = await (
        await fetch(`${base}/api/term/start`, { method: "POST" })
      ).json();
      expect(started.ok).toBe(true);
      expect(typeof started.id).toBe("string");
      // a real pty: arrow UI with ANSI redraws; strip them before matching
      const strip = (s: string) =>
        s.replace(/\x1b\[[?!]?[0-9;]*[@-~]/g, "").replace(/\x1b[()][AB0]/g, "");
      let menu = "";
      for (let i = 0; i < 40 && !strip(menu).includes("What do you want to do?"); i++) {
        await new Promise((r) => setTimeout(r, 200));
        const p = await (await fetch(`${base}/api/term/poll?id=${started.id}`)).json();
        menu += p.output;
      }
      const clean = strip(menu);
      expect(clean).toContain("What do you want to do?");
      expect(clean).toContain("Web GUI");
      expect(clean).toContain("type a number");
      await fetch(`${base}/api/term/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: started.id, data: "17" }),
      });
      let bye = "";
      for (let i = 0; i < 40 && !strip(bye).includes("bye."); i++) {
        await new Promise((r) => setTimeout(r, 200));
        const p = await (await fetch(`${base}/api/term/poll?id=${started.id}`)).json();
        bye += p.output;
        if (p.exited && p.output === "") break;
      }
      expect(strip(bye)).toContain("bye.");
      const sh = await (
        await fetch(`${base}/api/term/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "shell" }),
        })
      ).json();
      expect(sh.ok).toBe(true);
      await fetch(`${base}/api/term/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sh.id, data: "echo hi-pty\n" }),
      });
      let echoed = "";
      for (let i = 0; i < 40 && !strip(echoed).includes("hi-pty"); i++) {
        await new Promise((r) => setTimeout(r, 200));
        const p = await (await fetch(`${base}/api/term/poll?id=${sh.id}`)).json();
        echoed += p.output;
      }
      expect(strip(echoed)).toContain("hi-pty");
      await fetch(`${base}/api/term/kill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sh.id }),
      });
      const page = await (await fetch(`${base}/`)).text();
      expect(page).toContain('data-page="overview"');
      expect(page).toContain("Project health at a glance");
      expect(page).toContain('data-page="settings"');
      expect(page).toContain("High contrast");
      for (const name of ["Harvest", "Espresso", "Glacier", "Moss"]) {
        expect(page).toContain(name);
      }
      for (const m of ['data-page="memory"', 'data-page="skills"', "Confirm before running", "Compact cards", "Remember last page", 'id="nav-update"', 'id="upd-pill"', 'id="upd-modal"', "Show update info", "nav-group", 'id="side-toggle"', "set-group", "pal-group", "Workspace", "Look and feel", 'id="term-out"', 'id="term-kbd-in"', 'id="term-shell"', 'id="term-menu"', "Click inside and type", 'data-page="about"', "System information", "Credits", "Licenses", "release date", "Not affiliated", "nor @theelephantcoder is affiliated with", "not affiliated with any agent vendor", "contact@theelephantcoder.com"]) {
        expect(page).toContain(m);
      }
    } finally {
      server.close();
    }
  }, 30000);
});

describe("haveBin", () => {
  it("finds real binaries without spawning", () => {
    expect(haveBin("node")).toBe(true);
    expect(haveBin("definitely-not-a-real-binary-xyz")).toBe(false);
    expect(haveBin("")).toBe(false);
  });
});

describe("welcome", () => {
  it("shows the plain title, no figlet remnants", () => {
    for (const w of [40, 80, 160, 300]) {
      const text = welcome(w);
      expect(text).toContain("agent-harness");
      expect(text).not.toContain("|___/");
      expect(text).not.toContain("█████");
    }
  });
  it("no welcome line ever exceeds its width", () => {
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    for (let w = 21; w <= 300; w++) {
      for (const line of strip(welcome(w)).split("\n")) {
        expect(line.length).toBeLessThanOrEqual(w);
      }
    }
  });
});

describe("ollama helpers", () => {
  it("formats megabytes and gigabytes", () => {
    expect(fmtMem(1024)).toBe("1MB");
    expect(fmtMem(1135821)).toBe("1.1GB");
    expect(fmtMem(Math.round(2.6 * 1024 * 1024))).toBe("2.6GB");
  });
  it("parses /api/ps, preferring vram size", () => {
    const rows = parseOllamaPs(
      '{"models": [{"name": "qwen2.5-coder:1.5b", "size_vram": 1163080498}, {"name": "x", "size": 1000}]}',
    );
    expect(rows).toEqual([
      { name: "qwen2.5-coder:1.5b", sizeKb: 1135821 },
      { name: "x", sizeKb: 1 },
    ]);
    expect(parseOllamaPs("nope")).toEqual([]);
    expect(parseOllamaPs('{"models": {}}')).toEqual([]);
  });
});

describe("buildMap", () => {
  it("caps file rows with a trailer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    try {
      for (let i = 0; i < MAP_MAX_FILES + 50; i++) {
        fs.writeFileSync(path.join(dir, `m${i}.ts`), "export const x = 1;\n");
      }
      const r = buildMap(dir);
      expect(r.files).toBe(MAP_MAX_FILES);
      expect(r.omitted).toBe(50);
      expect(r.text).toContain("more files omitted (grep the repo)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("does not follow symlink cycles", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    try {
      fs.mkdirSync(path.join(dir, "cyc"));
      fs.symlinkSync(dir, path.join(dir, "cyc", "up"));
      fs.writeFileSync(path.join(dir, "a.ts"), "export const x = 1;\n");
      const r = buildMap(dir);
      expect(r.files).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
      mapSymbols(
        "export function foo() {}\nexport const bar = 1;\nexport default x;",
      ),
    ).toEqual(["foo()", "bar", "default"]);
  });
  it("reads python defs and markdown titles", () => {
    expect(mapSymbols("def hello():\n  pass")).toEqual(["hello()"]);
    expect(mapSymbols("# Title\n\ntext")).toEqual(["Title"]);
  });
  it("caps at twelve", () => {
    const src = Array.from(
      { length: 20 },
      (_, i) => `export const v${i} = ${i};`,
    ).join("\n");
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
