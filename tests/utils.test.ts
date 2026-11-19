import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import {
  MAP_MAX_FILES,
  buildMap,
  costReport,
  cmpVersions,
  estTokens,
  fmtMem,
  haveBin,
  parseOllamaPs,
  startGuiServer,
  fmtTok,
  captureRunSingleton,
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
    assert.strictEqual(cmpVersions("0.2.1", "0.2.1"), 0);
    assert.strictEqual(cmpVersions("0.2.0", "0.2.1"), -1);
    assert.strictEqual(cmpVersions("0.10.0", "0.2.1"), 1);
    assert.strictEqual(cmpVersions("1.0", "1.0.1"), -1);
  });
});

describe("gui server", () => {
  it("releases command deadlines so a closed server can exit", () => {
    const entry = new URL("../dist/harness/cli.js", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { startGuiServer } from ${JSON.stringify(entry)};
      const { server, port } = await startGuiServer(0);
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "version", args: [] }),
        });
        const result = await response.json();
        if (!result.ok) throw new Error("version command failed");
      } finally {
        server.close();
        server.closeAllConnections();
      }
    `,
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
  });

  it("serializes overlapping runs", async () => {
    // same tick: the first call flips the busy flag, so the second must bounce
    const p1 = captureRunSingleton("version", []);
    const p2 = captureRunSingleton("version", []);
    const [r1, r2] = await Promise.all([p1, p2]);
    const busy = [r1, r2].filter((r) =>
      r.output.includes("a run is already active"),
    );
    const ran = [r1, r2].filter((r) => r.ok && !r.output.includes("already"));
    assert.strictEqual(busy.length, 1);
    assert.strictEqual(ran.length, 1);
  });

  it("rejects cross-site and non-json requests (csrf wall)", async () => {
    const { server, port } = await startGuiServer(0);
    try {
      const base = `http://127.0.0.1:${port}`;
      // a website in the user's browser: cross-site origin
      const evil = await fetch(`${base}/api/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ cmd: "version", args: [] }),
      });
      assert.strictEqual(evil.status, 403);
      // classic form-crafted body: no preflight, wrong content type
      const form = await fetch(`${base}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: '{"cmd":"version","args":[]}',
      });
      assert.strictEqual(form.status, 415);
      // <img>-style drain: browser marks it cross-site
      const img = await fetch(`${base}/api/term/poll?id=x`, {
        headers: { "Sec-Fetch-Site": "cross-site" },
      });
      assert.strictEqual(img.status, 403);
      // dns rebinding: hostile host header. fetch ignores Host overrides,
      // so drive the socket directly with node:http
      const rebind = await new Promise<number>((resolve) => {
        const req = http.request(
          `${base}/api/status`,
          { headers: { host: "attacker.example" } },
          (r) => {
            r.resume();
            r.on("end", () => resolve(r.statusCode ?? 0));
          },
        );
        req.on("error", () => resolve(0));
        req.end();
      });
      assert.strictEqual(rebind, 403);
      // the honest tool path still works:
      const ok = await fetch(`${base}/api/status`);
      assert.strictEqual(ok.status, 200);
      // malformed json now a clean 400, not a 500
      const bad = await fetch(`${base}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{oops",
      });
      assert.strictEqual(bad.status, 400);
    } finally {
      server.close();
    }
  });

  it(
    "serves status, runs commands, rejects bad input",
    { timeout: 30000 },
    async () => {
      const { server, port } = await startGuiServer(0);
      try {
        const base = `http://127.0.0.1:${port}`;
        const status = await (await fetch(`${base}/api/status`)).json();
        assert.match(status.version, /^\d+\.\d+\.\d+$/);
        assert.strictEqual(typeof status.cwd, "string");
        assert.strictEqual(typeof status.project, "object");
        assert.strictEqual(typeof status.project.skills, "number");
        const upd = await (await fetch(`${base}/api/update-info`)).json();
        assert.match(upd.version, /^\d+\.\d+\.\d+$/);
        assert.strictEqual(typeof upd.node, "string");
        if (upd.commit !== null) assert.match(upd.commit, /^[0-9a-f]{40}$/);
        assert.strictEqual(typeof upd.sys, "object");
        assert.strictEqual(typeof upd.license, "object");
        const upd2 = await (await fetch(`${base}/api/update-info`)).json();
        assert.deepStrictEqual(upd2.latest, upd.latest);
        assert.deepStrictEqual(upd2.commit, upd.commit);
        const run = await (
          await fetch(`${base}/api/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd: "version", args: [] }),
          })
        ).json();
        assert.strictEqual(run.ok, true);
        assert.ok(run.output.includes("harness"));
        const blocked = await (
          await fetch(`${base}/api/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd: "upgrade", args: [] }),
          })
        ).json();
        assert.strictEqual(blocked.ok, false);
        const noAgent = await (
          await fetch(`${base}/api/agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent: "nope", prompt: "hi" }),
          })
        ).json();
        assert.strictEqual(noAgent.ok, false);
        const started = await (
          await fetch(`${base}/api/term/start`, { method: "POST" })
        ).json();
        assert.strictEqual(started.ok, true);
        assert.strictEqual(typeof started.id, "string");
        // a real pty: arrow UI with ANSI redraws; strip them before matching
        const strip = (s: string) =>
          s
            .replace(/\x1b\[[?!]?[0-9;]*[@-~]/g, "")
            .replace(/\x1b[()][AB0]/g, "");
        let menu = "";
        for (
          let i = 0;
          i < 40 && !strip(menu).includes("What do you want to do?");
          i++
        ) {
          await new Promise((r) => setTimeout(r, 200));
          const p = await (
            await fetch(`${base}/api/term/poll?id=${started.id}`)
          ).json();
          menu += p.output;
        }
        const clean = strip(menu);
        assert.ok(clean.includes("What do you want to do?"));
        assert.ok(clean.includes("Web GUI"));
        assert.ok(clean.includes("esc back"));
        await fetch(`${base}/api/term/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: started.id, data: "q" }),
        });
        let bye = "";
        for (let i = 0; i < 40 && !strip(bye).includes("bye."); i++) {
          await new Promise((r) => setTimeout(r, 200));
          const p = await (
            await fetch(`${base}/api/term/poll?id=${started.id}`)
          ).json();
          bye += p.output;
          if (p.exited && p.output === "") break;
        }
        assert.ok(strip(bye).includes("bye."));
        const sh = await (
          await fetch(`${base}/api/term/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "shell" }),
          })
        ).json();
        assert.strictEqual(sh.ok, true);
        await fetch(`${base}/api/term/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sh.id, data: "echo hi-pty\n" }),
        });
        let echoed = "";
        for (let i = 0; i < 40 && !strip(echoed).includes("hi-pty"); i++) {
          await new Promise((r) => setTimeout(r, 200));
          const p = await (
            await fetch(`${base}/api/term/poll?id=${sh.id}`)
          ).json();
          echoed += p.output;
        }
        assert.ok(strip(echoed).includes("hi-pty"));
        await fetch(`${base}/api/term/kill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sh.id }),
        });
        const page = await (await fetch(`${base}/`)).text();
        assert.ok(page.includes('data-page="overview"'));
        assert.ok(page.includes("Project health at a glance"));
        assert.ok(page.includes('data-page="settings"'));
        assert.ok(page.includes("High contrast"));
        for (const name of ["Harvest", "Espresso", "Glacier", "Moss"]) {
          assert.ok(page.includes(name));
        }
        for (const m of [
          'data-page="memory"',
          'data-page="skills"',
          "Confirm before running",
          "Compact cards",
          "Remember last page",
          'id="nav-update"',
          'id="upd-pill"',
          'id="upd-modal"',
          "Show update info",
          "nav-group",
          'id="side-toggle"',
          "set-group",
          "pal-group",
          "Workspace",
          "Look and feel",
          'id="term-out"',
          'id="term-kbd-in"',
          'id="term-shell"',
          'id="term-menu"',
          "Click inside and type",
          'data-page="about"',
          "System information",
          "Credits",
          "Licenses",
          "release date",
          "Not affiliated",
          "nor @theelephantcoder is affiliated with",
          "not affiliated with any agent vendor",
          "contact@theelephantcoder.com",
        ]) {
          // prettier rewraps template prose, so compare against collapsed
          // whitespace instead of raw page text
          assert.ok(page.replace(/\s+/g, " ").includes(m));
        }
      } finally {
        server.close();
      }
    },
  );
});

describe("haveBin", () => {
  it("finds real binaries without spawning", () => {
    assert.strictEqual(haveBin("node"), true);
    assert.strictEqual(haveBin("definitely-not-a-real-binary-xyz"), false);
    assert.strictEqual(haveBin(""), false);
  });
});

describe("welcome", () => {
  it("shows the plain title, no figlet remnants", () => {
    for (const w of [40, 80, 160, 300]) {
      const text = welcome(w);
      assert.ok(text.includes("agent-harness"));
      assert.ok(!text.includes("|___/"));
      assert.ok(!text.includes("█████"));
    }
  });
  it("no welcome line ever exceeds its width", () => {
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    for (let w = 21; w <= 300; w++) {
      for (const line of strip(welcome(w)).split("\n")) {
        assert.ok(line.length <= w);
      }
    }
  });
});

describe("ollama helpers", () => {
  it("formats megabytes and gigabytes", () => {
    assert.strictEqual(fmtMem(1024), "1MB");
    assert.strictEqual(fmtMem(1135821), "1.1GB");
    assert.strictEqual(fmtMem(Math.round(2.6 * 1024 * 1024)), "2.6GB");
  });
  it("parses /api/ps, preferring vram size", () => {
    const rows = parseOllamaPs(
      '{"models": [{"name": "qwen2.5-coder:1.5b", "size_vram": 1163080498}, {"name": "x", "size": 1000}]}',
    );
    assert.deepStrictEqual(rows, [
      { name: "qwen2.5-coder:1.5b", sizeKb: 1135821 },
      { name: "x", sizeKb: 1 },
    ]);
    assert.deepStrictEqual(parseOllamaPs("nope"), []);
    assert.deepStrictEqual(parseOllamaPs('{"models": {}}'), []);
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
      assert.strictEqual(r.files, MAP_MAX_FILES);
      assert.strictEqual(r.omitted, 50);
      assert.ok(r.text.includes("more files omitted (grep the repo)"));
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
      assert.strictEqual(r.files, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("costReport", () => {
  it("costs text files, skips binary, oversize, dotfiles and vendor dirs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cost-"));
    try {
      fs.writeFileSync(path.join(dir, "big.md"), "x".repeat(400)); // 100 tok
      fs.writeFileSync(path.join(dir, "small.toml"), "y".repeat(80)); // 20 tok
      fs.writeFileSync(
        path.join(dir, "bin.dat"),
        Buffer.from([0x61, 0x00, 0x62]),
      );
      fs.writeFileSync(path.join(dir, ".hidden"), "z".repeat(40));
      fs.mkdirSync(path.join(dir, "node_modules"));
      fs.writeFileSync(
        path.join(dir, "node_modules", "dep.md"),
        "d".repeat(40),
      );
      const big = path.join(dir, "huge.log");
      fs.writeFileSync(big, "a".repeat(600 * 1024));
      const r = costReport(dir, ".", false);
      assert.deepStrictEqual(
        r.files.map((f) => f.rel),
        ["big.md", "small.toml"],
      );
      assert.strictEqual(r.total, 120);
      assert.strictEqual(r.skippedBinary, 1);
      assert.strictEqual(r.skippedLarge, 1);
      // single-file mode: exact cost even for an oversize-capped file
      const one = costReport(dir, "big.md", false);
      assert.strictEqual(one.files.length, 1);
      assert.strictEqual(one.total, 100);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("skips binary files for direct paths and directory scans", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cost-"));
    try {
      for (const bytes of [
        [0x61, 0x00, 0x62],
        [0xff, 0x00, 0xfe],
      ]) {
        fs.writeFileSync(path.join(dir, "sample.bin"), Buffer.from(bytes));
        for (const target of ["sample.bin", "."]) {
          const r = costReport(dir, target, false);
          assert.deepStrictEqual(r.files, []);
          assert.strictEqual(r.total, 0);
          assert.strictEqual(r.skippedBinary, 1);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("caps rows at 12 and lifts the cap with --all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cost-"));
    try {
      for (let i = 0; i < 15; i++) {
        fs.writeFileSync(path.join(dir, `f${i}.md`), "x".repeat(40));
      }
      const capped = costReport(dir, ".", false);
      assert.strictEqual(capped.shown, 12);
      assert.strictEqual(capped.files.length, 15);
      const all = costReport(dir, ".", true);
      assert.strictEqual(all.shown, 15);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseFrontmatter", () => {
  it("parses name and description", () => {
    const fm = parseFrontmatter("---\nname: x\ndescription: y\n---\nbody");
    assert.deepStrictEqual(fm, { name: "x", desc: "y" });
  });
  it("rejects missing frontmatter", () => {
    assert.strictEqual(parseFrontmatter("no frontmatter"), null);
  });
  it("rejects missing description", () => {
    assert.strictEqual(parseFrontmatter("---\nname: x\n---\nbody"), null);
  });
  it("parses frontmatter ending at the fence without a newline", () => {
    const fm = parseFrontmatter("---\nname: x\ndescription: y\n---");
    assert.deepStrictEqual(fm, { name: "x", desc: "y" });
  });
});

describe("tokens", () => {
  it("estimates 4 chars per token", () => {
    assert.strictEqual(estTokens("a".repeat(8)), 2);
  });
  it("formats thousands", () => {
    assert.strictEqual(fmtTok(999), "999");
    assert.strictEqual(fmtTok(1500), "1.5k");
  });
});

describe("stripFm", () => {
  it("removes leading frontmatter", () => {
    assert.strictEqual(stripFm("---\nname: x\n---\nbody"), "body");
  });
  it("leaves plain text alone", () => {
    assert.strictEqual(stripFm("body"), "body");
  });
  it("strips when the file ends at the closing fence", () => {
    assert.strictEqual(stripFm("---\nname: x\ndescription: y\n---"), "");
  });
});

describe("mapSymbols", () => {
  it("extracts exports", () => {
    assert.deepStrictEqual(
      mapSymbols(
        "export function foo() {}\nexport const bar = 1;\nexport default x;",
      ),
      ["foo()", "bar", "default"],
    );
  });
  it("reads python defs and markdown titles", () => {
    assert.deepStrictEqual(mapSymbols("def hello():\n  pass"), ["hello()"]);
    assert.deepStrictEqual(mapSymbols("# Title\n\ntext"), ["Title"]);
  });
  it("caps at twelve", () => {
    const src = Array.from(
      { length: 20 },
      (_, i) => `export const v${i} = ${i};`,
    ).join("\n");
    assert.strictEqual(mapSymbols(src).length, 12);
  });
});

describe("slowHooks", () => {
  it("flags only hooks over budget, sorted", () => {
    assert.deepStrictEqual(
      slowHooks({ a: 10, b: 2500, c: 2000, d: 2001 }, 2000),
      ["b", "d"],
    );
    assert.deepStrictEqual(slowHooks({}, 2000), []);
  });
});

describe("slugify", () => {
  it("slugifies queries", () => {
    assert.strictEqual(slugify("Token Overhead?!"), "token-overhead");
  });
  it("falls back on empty", () => {
    assert.strictEqual(slugify("!!!"), "note");
  });
});

describe("sanitizeSkillName", () => {
  it("lowercases and hyphenates", () => {
    assert.strictEqual(sanitizeSkillName("My Skill!"), "my-skill");
  });
});

describe("sha256", () => {
  it("hashes deterministically", () => {
    assert.strictEqual(
      sha256("abc"),
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
    assert.strictEqual(r?.moved, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("archives overflow past budget", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
    const f = path.join(dir, "MEMORY.md");
    fs.writeFileSync(f, big);
    const before = estTokens(big);
    const r = pruneFile(f, 100);
    assert.notStrictEqual(r, null);
    assert.strictEqual(r!.before, before);
    assert.ok(r!.moved > 0);
    assert.ok(r!.after <= 100);
    assert.strictEqual(
      fs.existsSync(path.join(dir, "MEMORY.archive.md")),
      true,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("returns null for missing files", () => {
    assert.strictEqual(pruneFile("/no/such/file.md", 100), null);
  });
});
