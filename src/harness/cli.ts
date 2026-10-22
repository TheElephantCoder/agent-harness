#!/usr/bin/env node
// harness cli - small shim, real logic lives in the scripts and hooks
// node >=20

import * as readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.3.0";

// true while serving the web gui: prompts have no terminal to read from,
// so askQuestion/selectOption bail out and callers degrade gracefully.
let guiMode = false;

type Command =
  | "init"
  | "doctor"
  | "status"
  | "bench"
  | "skill"
  | "memory"
  | "instinct"
  | "research"
  | "security"
  | "upgrade"
  | "optimize"
  | "optimizations"
  | "adapter"
  | "map"
  | "gui"
  | "help"
  | "version";

const ART = [
  "                                              *",
  "          ·                             *",
  "                        ·          ◆",
  "     *                       ·",
  "                          ·",
  "               ·                    ·         *",
  "     ·                        ·",
  "                          *           ·     ·",
  "               *                     ·",
  "  ·                     ·                      ◆",
  "                                           ·",
];

function termWidth(): number {
  const w = process.stdout.columns;
  return typeof w === "number" && w > 20 ? w : 80;
}

function centerLine(line: string, width: number): string {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, Math.floor((width - plain.length) / 2));
  return " ".repeat(pad) + line;
}
function paintArt(line: string): string {
  return line
    .split("")
    .map((ch) => {
      if (ch === "◆") return paint(ANSI.magenta + ANSI.bold, ch);
      if (ch === "*") return paint(ANSI.cyan, ch);
      return paint(ANSI.dim, ch);
    })
    .join("");
}

// width override exists for tests; the live call reads the terminal.
export function welcome(width: number = termWidth()): string {
  const rule = paint(ANSI.dim, "·".repeat(width));
  const divider = paint(ANSI.dim, "╌".repeat(width));
  // the starfield is 48 wide; on narrower screens it would wrap-tear,
  // so it steps aside and the banner carries the welcome alone.
  const art =
    width < 50 ? "" : ART.map((l) => centerLine(paintArt(l), width)).join("\n");
  const titleText =
    width < 31
      ? `agent-harness ${paint(ANSI.dim, `v${VERSION}`)}`
      : `Welcome to ${paint(ANSI.bold, "agent-harness")} ${paint(ANSI.dim, `v${VERSION}`)}`;
  const title = centerLine(titleText, width);
  const sub = centerLine(paint(ANSI.dim, "Let's get started."), width);
  const credit = centerLine(paint(ANSI.dim, "by TheElephantCoder"), width);
  return (
    [rule, "", art, "", title, "", sub, credit, ""].join("\n") + "\n" + divider
  );
}
function help() {
  console.log(`
harness v${VERSION} - agent harness perf layer by TheElephantCoder

usage: harness <command> [options]

  init [--harness <name>] [--auto] [--migrate] [--dry-run] [--force] install into current project
  doctor [--fix] [--strict] [--json]               verify install and project
  status                                         project snapshot: memory, skills, hooks, last bench
  bench [--compare] [--quick]                    measure costs, save baseline
  optimize                                       prune memory, repair, report savings
  optimizations [enable|disable] [name|all]      list, toggle optimizations
  map                                            index repo to .harness/MAP.md
  skill <list|search|info|add|remove|verify|lint|update> ... list, search, show, fetch, check, refresh skills
  memory <show|prune|sync|edit|stats|search|backup> [note] show, prune, append, edit, inspect MEMORY.md
  instinct <list|enable|disable|test> [name]     list, toggle, run hooks
  research [query|search|remove] ...             capture, find, drop findings
  security <audit|scan> [--staged]               run the audit script
  adapter <list|add|remove> [name]                 list, scaffold, drop harnesses
  upgrade [--check]                              self-update to latest
  gui [--port <n>]                               local web gui on 127.0.0.1

options:
  -h, --help
  -v, --version

run with no args on a terminal to open the interactive menu.

examples:
  harness init --auto
  harness doctor --fix
  harness bench --quick --compare
  harness optimize

https://github.com/TheElephantCoder/agent-harness
`);
}

function parseArgs(argv: string[]) {
  const cmd = (argv[2] ?? "help") as Command;
  const flags = argv.slice(3);
  return { cmd, flags };
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function useColor(): boolean {
  return (
    !!process.stdout.isTTY &&
    !process.env.NO_COLOR &&
    process.env.TERM !== "dumb"
  );
}

function paint(code: string, text: string): string {
  return useColor() ? `${code}${text}${ANSI.reset}` : text;
}

async function selectFallback(
  title: string,
  options: string[],
): Promise<number> {
  console.log(paint(ANSI.bold, title));
  options.forEach((o, i) => {
    console.log(`  ${i + 1}. ${o}`);
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(paint(ANSI.cyan, "❯ "), (a) => {
      rl.close();
      resolve(a);
    });
  });
  const n = parseInt(answer.trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > options.length) {
    return -1;
  }
  return n - 1;
}

async function selectOption(title: string, options: string[]): Promise<number> {
  // arrow redraw math assumes no line wraps (longest line is 44 cells),
  // so narrow screens get the numbered fallback instead of torn redraws.
  if (guiMode) return -1;
  if (!process.stdin.isTTY || !process.stdout.isTTY || termWidth() < 45) {
    return selectFallback(title, options);
  }
  return new Promise<number>((resolve) => {
    let index = 0;
    let rendered = 0;
    let finished = false;
    // first digit of a two-digit option number, with its commit timer.
    let pendingDigit = 0;
    let pendingTimer: NodeJS.Timeout | null = null;
    const clearPending = () => {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingDigit = 0;
    };
    const stdin = process.stdin;
    const hint = paint(
      ANSI.dim,
      "↑↓ to move · enter to select · type a number",
    );
    const draw = () => {
      let out = `${paint(ANSI.bold, title)}\n`;
      options.forEach((o, i) => {
        out +=
          i === index
            ? `${paint(ANSI.cyan + ANSI.bold, "❯")} ${paint(ANSI.bold, `${i + 1}. ${o}`)}\n`
            : paint(ANSI.dim, `  ${i + 1}. ${o}`) + "\n";
      });
      out += `${hint}\n`;
      const lines = out.split("\n").length;
      if (rendered > 0) {
        process.stdout.write(`\x1b[${rendered}A`);
      }
      out.split("\n").forEach((l) => {
        process.stdout.write("\x1b[G\x1b[K" + l + "\n");
      });
      rendered = lines;
    };
    const done = (n: number) => {
      if (finished) return;
      finished = true;
      clearPending();
      stdin.setRawMode(false);
      stdin.removeAllListeners("keypress");
      stdin.pause();
      resolve(n);
    };
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", (_ch, key) => {
      if (!key) {
        return;
      }
      if (key.ctrl && key.name === "c") {
        process.stdout.write("\n");
        done(-1);
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        process.stdout.write("\n");
        done(index);
        return;
      }
      if (key.name === "up" || key.name === "k") {
        clearPending();
        index = (index - 1 + options.length) % options.length;
        draw();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        clearPending();
        index = (index + 1) % options.length;
        draw();
        return;
      }
      if (key.name === "escape" || key.name === "q") {
        process.stdout.write("\n");
        done(-1);
        return;
      }
      // digits select immediately when unambiguous (d*10 exceeds the
      // option count); otherwise the first digit waits 450ms for a second.
      // out-of-range digits are ignored so a typo cannot escape a submenu.
      const d = parseInt(key.sequence, 10);
      if (!Number.isNaN(d) && d >= 0 && d <= 9) {
        if (pendingTimer) {
          const first = pendingDigit;
          clearPending();
          const two = first * 10 + d;
          if (two >= 1 && two <= options.length) {
            process.stdout.write("\n");
            done(two - 1);
            return;
          }
          if (first >= 1 && first <= options.length) {
            process.stdout.write("\n");
            done(first - 1);
            return;
          }
          return;
        }
        if (
          d >= 1 &&
          d <= options.length &&
          (d * 10 > options.length || options.length < 10)
        ) {
          process.stdout.write("\n");
          done(d - 1);
          return;
        }
        if (d >= 1 && d * 10 <= options.length) {
          pendingDigit = d;
          pendingTimer = setTimeout(() => {
            pendingTimer = null;
            process.stdout.write("\n");
            done(d - 1);
          }, 450);
        }
      }
    });
    draw();
  });
}

async function askQuestion(prompt: string): Promise<string> {
  // under the web gui there is no terminal to ask on: callers treat ""
  // as "cancelled", so every guided flow degrades to a usage message.
  if (guiMode) return "";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer: string = await new Promise<string>((resolve) => {
      rl.question(paint(ANSI.cyan, `${prompt} `), (a) => {
        resolve(a.trim());
      });
      rl.on("close", () => resolve(""));
    });
    return answer;
  } catch {
    return "";
  } finally {
    try {
      rl.close();
    } catch {
      // ignore
    }
  }
}

async function pickAdapter(title: string): Promise<string | null> {
  const root = selfRoot();
  if (!root) {
    console.log("[harness] adapter - cannot locate install");
    return null;
  }
  const names = listAdapters(root)
    .filter((a) => a.json)
    .map((a) => a.name);
  const picked = await selectOption(title, [...names, "Back"]);
  if (picked < 0 || picked >= names.length) return null;
  return names[picked];
}

async function showMenu(): Promise<boolean> {
  const options = [
    "Set up this project",
    "Check setup",
    "Project status",
    "Run benchmark",
    "Optimize this project",
    "Manage optimizations",
    "Map this repo",
    "Skills",
    "Memory",
    "Instincts",
    "Research",
    "Security",
    "Adapters",
    "Upgrade",
    "Local models",
    "Web GUI",
    "Quit",
  ];
  const picked = await selectOption("What do you want to do?", options);
  if (picked < 0 || picked === 16) return true;
  if (picked === 0) {
    await setupMenu();
  } else if (picked === 1) {
    await checkMenu();
  } else if (picked === 2) {
    await runCommand("status", []);
  } else if (picked === 3) {
    await benchMenu();
  } else if (picked === 4) {
    await runCommand("optimize", []);
  } else if (picked === 5) {
    await showOptimizationsMenu();
  } else if (picked === 6) {
    await runCommand("map", []);
  } else if (picked === 7) {
    await skillsMenu();
  } else if (picked === 8) {
    await memoryMenu();
  } else if (picked === 9) {
    await instinctMenu();
  } else if (picked === 10) {
    await researchMenu();
  } else if (picked === 11) {
    await securityMenu();
  } else if (picked === 12) {
    await adapterMenu();
  } else if (picked === 13) {
    await runCommand("upgrade", []);
  } else if (picked === 14) {
    await localModelsMenu();
  } else if (picked === 15) {
    await runCommand("gui", []);
  }
  console.log(paint(ANSI.dim, "╌".repeat(termWidth())));
  return false;
}

function reportUnload(freed: {
  freedKb: number;
  count: number;
  stuck: number;
}): void {
  if (freed.count === 0 && freed.stuck === 0) {
    console.log("[harness] ok - local models: no resident ollama runners");
    return;
  }
  const alive = ollamaApi("/api/tags") !== null;
  if (freed.count > 0) {
    console.log(
      `[harness] ok - local models: unloaded ${freed.count} resident runner(s), ~${fmtMem(freed.freedKb)} freed${alive ? " (server healthy, reloads on next use)" : " (ollama api unreachable after unload - restart ollama if needed)"}`,
    );
  }
  if (freed.stuck > 0) {
    console.log(
      `[harness] warn - ${freed.stuck} runner(s) would not die (still resident, excluded from the freed total)`,
    );
  }
}

async function localModelsMenu(): Promise<void> {
  const picked = await selectOption("Local models", [
    "Show resident models",
    "Unload idle runners",
    "Back",
  ]);
  if (picked === 0) {
    const ol = ollamaState();
    if (ol === null) {
      console.log("[harness] local models: ollama not detected");
    } else {
      const names = ol.models.map((m) => m.name).join(", ");
      console.log(
        `[harness] local models: ${ol.runners.length} resident ~${fmtMem(ol.totalKb)}${names ? ` (${names})` : ""}`,
      );
    }
  } else if (picked === 1) {
    reportUnload(unloadOllamaRunners());
  }
}

async function setupMenu(): Promise<void> {
  const picked = await selectOption("Set up this project", [
    "Auto-detect + install",
    "Install for a specific harness",
    "Migrate (fill gaps)",
    "Preview only",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("init", ["--auto"]);
  } else if (picked === 1) {
    const name = await pickAdapter("Install for which harness?");
    if (name) {
      const initialized = fs.existsSync(
        path.join(process.cwd(), ".harness", "config.json"),
      );
      await runCommand(
        "init",
        initialized ? ["--harness", name, "--migrate"] : ["--harness", name],
      );
    }
  } else if (picked === 2) {
    await runCommand("init", ["--migrate"]);
  } else if (picked === 3) {
    await runCommand("init", ["--auto", "--dry-run"]);
  }
}

async function checkMenu(): Promise<void> {
  const picked = await selectOption("Check setup", [
    "Check",
    "Check + fix",
    "Strict check",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("doctor", []);
  } else if (picked === 1) {
    await runCommand("doctor", ["--fix"]);
  } else if (picked === 2) {
    await runCommand("doctor", ["--strict"]);
  }
}

async function benchMenu(): Promise<void> {
  const picked = await selectOption("Run benchmark", [
    "Quick",
    "Full",
    "Compare with baseline",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("bench", ["--quick"]);
  } else if (picked === 1) {
    await runCommand("bench", []);
  } else if (picked === 2) {
    await runCommand("bench", ["--compare"]);
  }
}

async function skillsMenu(): Promise<void> {
  const picked = await selectOption("Skills", [
    "List",
    "Search",
    "Show info",
    "Add",
    "Remove",
    "Verify",
    "Lint",
    "Update",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("skill", ["list"]);
  } else if (picked === 1) {
    const q = await askQuestion("Search skills for?");
    if (q) await runCommand("skill", ["search", q]);
  } else if (picked === 2) {
    const n = await askQuestion("Which skill?");
    if (n) await runCommand("skill", ["info", n]);
  } else if (picked === 3) {
    const s = await askQuestion("Add what? (owner/repo, URL, or --path dir)");
    if (s) await runCommand("skill", ["add", ...s.split(/\s+/)]);
  } else if (picked === 4) {
    const n = await askQuestion("Remove which added skill?");
    if (n) await runCommand("skill", ["remove", n]);
  } else if (picked === 5) {
    await runCommand("skill", ["verify"]);
  } else if (picked === 6) {
    await runCommand("skill", ["lint"]);
  } else if (picked === 7) {
    const n = await askQuestion("Update which added skill?");
    if (n) await runCommand("skill", ["update", n]);
  }
}

async function memoryMenu(): Promise<void> {
  const picked = await selectOption("Memory", [
    "Show",
    "Prune",
    "Sync a note",
    "Edit",
    "Stats",
    "Search",
    "Backup",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("memory", ["show"]);
  } else if (picked === 1) {
    await runCommand("memory", ["prune"]);
  } else if (picked === 2) {
    const n = await askQuestion("Note to append?");
    if (n) await runCommand("memory", ["sync", n]);
  } else if (picked === 3) {
    await runCommand("memory", ["edit"]);
  } else if (picked === 4) {
    await runCommand("memory", ["stats"]);
  } else if (picked === 5) {
    const n = await askQuestion("Search memory for?");
    if (n) await runCommand("memory", ["search", n]);
  } else if (picked === 6) {
    await runCommand("memory", ["backup"]);
  }
}

async function instinctMenu(): Promise<void> {
  const picked = await selectOption("Instincts", [
    "List",
    "Enable",
    "Disable",
    "Test hook",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("instinct", ["list"]);
  } else if (picked === 1 || picked === 2) {
    const n = await askQuestion(
      `${picked === 1 ? "Enable" : "Disable"} which hook?`,
    );
    if (n)
      await runCommand("instinct", [picked === 1 ? "enable" : "disable", n]);
  } else if (picked === 3) {
    const n = await askQuestion("Test which hook?");
    if (n) await runCommand("instinct", ["test", n]);
  }
}

async function researchMenu(): Promise<void> {
  const picked = await selectOption("Research", [
    "List findings",
    "Capture query",
    "Search findings",
    "Remove",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("research", []);
  } else if (picked === 1) {
    const q = await askQuestion("Query to capture?");
    if (q) await runCommand("research", [q]);
  } else if (picked === 2) {
    const q = await askQuestion("Search findings for?");
    if (q) await runCommand("research", ["search", q]);
  } else if (picked === 3) {
    const n = await askQuestion("Remove which finding?");
    if (n) await runCommand("research", ["remove", n]);
  }
}

async function securityMenu(): Promise<void> {
  const picked = await selectOption("Security", [
    "Audit",
    "Staged scan",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("security", ["audit"]);
  } else if (picked === 1) {
    await runCommand("security", ["scan"]);
  }
}

async function adapterMenu(): Promise<void> {
  const picked = await selectOption("Adapters", [
    "List",
    "Add",
    "Remove",
    "Back",
  ]);
  if (picked === 0) {
    await runCommand("adapter", ["list"]);
  } else if (picked === 1) {
    const n = await askQuestion("New adapter name? (lowercase-hyphen)");
    if (n) await runCommand("adapter", ["add", n]);
  } else if (picked === 2) {
    const n = await askQuestion("Remove which custom adapter?");
    if (n) await runCommand("adapter", ["remove", n]);
  }
}

async function showOptimizationsMenu(): Promise<void> {
  for (;;) {
    const opts = readOptimizations(process.cwd());
    console.log("[harness] optimizations (all on by default):");
    const names = OPTIMIZATIONS.map((o) => o.name);
    names.forEach((n, i) => {
      const o = OPTIMIZATIONS[i];
      console.log(
        `  ${i + 1}. ${n} [${o.scope}] ${opts[n] ? "on" : "off"} - ${o.desc}`,
      );
    });
    console.log(`  ${names.length + 1}. Back`);
    const picked = await selectOption("Toggle which?", [
      ...names.map((n) => `toggle ${n}`),
      "Back",
    ]);
    if (picked < 0 || picked >= names.length) return;
    const name = names[picked];
    if (opts[name]) {
      cmdOptimizations(["disable", name]);
    } else {
      cmdOptimizations(["enable", name]);
    }
  }
}

async function interactive() {
  console.log(welcome());
  for (;;) {
    const quit = await showMenu();
    if (quit) break;
  }
  console.log(paint(ANSI.dim, "bye."));
}

// same tarball the README install uses; registry publish is still pending,
// so self-update reinstalls from here instead of `npm update -g`.
const UPGRADE_TARBALL =
  "https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/refs/heads/main";
const NPM_MANUAL = `npm install -g ${UPGRADE_TARBALL}`;

// install root of the running copy, or null when it cannot be located.
function selfRoot(): string | null {
  try {
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    const root = path.dirname(path.dirname(path.dirname(self)));
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    if (pkg?.name === "@theelephantcoder/agent-harness") return root;
  } catch {
    // fall through to manual instructions
  }
  return null;
}

export function haveBin(bin: string): boolean {
  // Presence check only: scan PATH in-process instead of spawning
  // `bin --version` (~10-20ms a call). Callers run the binary for real
  // when it matters, so a broken-but-present binary still fails honestly.
  try {
    if (bin.includes(path.sep)) {
      fs.accessSync(bin, fs.constants.X_OK);
      return fs.statSync(bin).isFile();
    }
    const dirs = (process.env.PATH ?? "").split(path.delimiter);
    const exts =
      process.platform === "win32"
        ? (process.env.PATHEXT ?? ".EXE").split(";")
        : [""];
    for (const d of dirs) {
      if (!d) continue;
      for (const e of exts) {
        const f = path.join(d, bin + e);
        try {
          fs.accessSync(f, fs.constants.X_OK);
          if (fs.statSync(f).isFile()) return true;
        } catch {
          // next candidate
        }
      }
    }
  } catch {
    // not found
  }
  return false;
}

// branch tarballs are cached aggressively (npm served a stale one twice),
// so upgrade resolves main to a sha and installs the immutable sha tarball.
function resolveMainSha(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = https.get(
        "https://api.github.com/repos/TheElephantCoder/agent-harness/commits/main",
        {
          headers: {
            "User-Agent": "agent-harness",
            Accept: "application/vnd.github+json",
          },
        },
        (res) => {
          let body = "";
          res.on("data", (c) => {
            body += c;
          });
          res.on("end", () => {
            const m = /"sha"\s*:\s*"([0-9a-f]{40})"/.exec(body);
            resolve(res.statusCode === 200 && m ? m[1] : null);
          });
        },
      );
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function plainLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

const UPGRADE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useUpgradeBar(): boolean {
  return (
    !!process.stdout.isTTY && process.env.TERM !== "dumb" && termWidth() >= 50
  );
}

function upgradeBar(pct: number, stage: string, frame: string): string {
  const width = termWidth();
  const head = `upgrade ${frame} `;
  const tail = ` ${Math.round(pct)}% ${stage}`;
  const barWidth = Math.max(10, width - plainLen(head) - plainLen(tail) - 2);
  const filled = Math.min(barWidth, Math.round((pct / 100) * barWidth));
  const bar =
    paint(ANSI.cyan, "█".repeat(filled)) +
    paint(ANSI.dim, "░".repeat(barWidth - filled));
  return `\r${head}[${bar}]${tail}`;
}

// npm quiets down when piped, so its output is captured and only the
// tail is shown on failure. the bar creeps toward 90% while npm works.
function runNpmUpgrade(
  url: string,
): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", url], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", () => resolve({ status: 1, out }));
    child.on("close", (status) => resolve({ status, out }));
  });
}

async function animatedNpmUpgrade(
  pinned: string,
  label: string,
): Promise<{ status: number | null; out: string }> {
  let frame = 0;
  let pct = 18;
  let stage = `reinstalling ${label}`;
  const draw = () => {
    process.stdout.write(
      upgradeBar(pct, stage, UPGRADE_FRAMES[frame % UPGRADE_FRAMES.length]),
    );
  };
  process.stdout.write("\x1b[?25l");
  const tick = setInterval(() => {
    frame += 1;
    pct = Math.min(90, pct + (90 - pct) * 0.06 + 0.25);
    draw();
  }, 90);
  try {
    draw();
    const result = await runNpmUpgrade(pinned);
    stage = result.status === 0 ? "verifying" : "failed";
    pct = 100;
    frame += 1;
    draw();
    return result;
  } finally {
    clearInterval(tick);
    process.stdout.write("\x1b[?25h\n");
  }
}

export function cmpVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0))
      return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

// read-only version of upgrade: report only, change nothing.
async function cmdUpgradeCheck(): Promise<boolean> {
  const root = selfRoot();
  if (root && fs.existsSync(path.join(root, ".git"))) {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    const head = typeof r.stdout === "string" ? r.stdout.trim() : "";
    const sha = await resolveMainSha();
    if (!sha) {
      console.log("[harness] upgrade check - could not reach github");
      return false;
    }
    if (head === sha.slice(0, 7)) {
      console.log(`[harness] ok - up to date (${head})`);
    } else {
      console.log(
        `[harness] upgrade available - local ${head || "?"}, main ${sha.slice(0, 7)} (run: git pull)`,
      );
    }
    return true;
  }
  const npmManaged =
    !!root &&
    root.includes(
      ["node_modules", "@theelephantcoder", "agent-harness"].join(path.sep),
    );
  if (npmManaged && root) {
    let installed = VERSION;
    try {
      installed =
        JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
          .version ?? VERSION;
    } catch {
      // keep compiled-in VERSION
    }
    const text = await fetchText(
      "https://raw.githubusercontent.com/TheElephantCoder/agent-harness/main/package.json",
      64 * 1024,
    );
    if (!text) {
      console.log("[harness] upgrade check - could not reach github");
      return false;
    }
    let main: string | null = null;
    try {
      main = JSON.parse(text).version ?? null;
    } catch {
      main = null;
    }
    if (!main) {
      console.log("[harness] upgrade check - could not read main version");
      return false;
    }
    if (cmpVersions(installed, main) >= 0) {
      console.log(`[harness] ok - up to date (v${installed})`);
    } else {
      console.log(
        `[harness] upgrade available - installed v${installed}, main v${main} (run: harness upgrade)`,
      );
    }
    return true;
  }
  // brew/apt/manual installs: same pointers upgrade itself prints.
  if (
    root &&
    root.includes([path.sep + "Cellar", "agent-harness"].join(path.sep))
  ) {
    console.log(
      "[harness] upgrade check - brew install: compare with `brew info agent-harness` (upgrade: brew upgrade agent-harness)",
    );
    return true;
  }
  if (
    root &&
    root.includes([path.sep + "usr", "lib", "agent-harness"].join(path.sep))
  ) {
    console.log(
      "[harness] upgrade check - apt install (upgrade: sudo apt update && sudo apt upgrade agent-harness)",
    );
    return true;
  }
  console.log(
    `[harness] upgrade check - manual install (upgrade: ${NPM_MANUAL})`,
  );
  return true;
}

async function selfUpgrade(): Promise<boolean> {
  const root = selfRoot();
  if (root && fs.existsSync(path.join(root, ".git"))) {
    console.log("[harness] source checkout - run: git pull");
    return true;
  }
  const npmManaged =
    !!root &&
    root.includes(
      ["node_modules", "@theelephantcoder", "agent-harness"].join(path.sep),
    );
  if (npmManaged && root) {
    if (!haveBin("npm")) {
      console.log(`[harness] npm not found - run: ${NPM_MANUAL}`);
      return false;
    }
    const sha = await resolveMainSha();
    const url = sha
      ? `https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/${sha}`
      : UPGRADE_TARBALL;
    const tag = sha ? sha.slice(0, 7) : "latest";
    if (useUpgradeBar()) {
      const result = await animatedNpmUpgrade(url, tag);
      if (result.status !== 0) {
        const tail = result.out.trim().split("\n").slice(-12).join("\n");
        if (tail) console.log(tail);
        console.log(`[harness] upgrade failed - try: ${NPM_MANUAL}`);
        return false;
      }
    } else {
      console.log(
        `[harness] upgrade - reinstalling ${sha ? sha.slice(0, 7) : "latest"} via npm...`,
      );
      const r = spawnSync("npm", ["install", "-g", url], {
        stdio: "inherit",
      });
      if (r.status !== 0) {
        console.log(`[harness] upgrade failed - try: ${NPM_MANUAL}`);
        return false;
      }
    }
    let v = VERSION;
    try {
      v =
        JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
          .version ?? VERSION;
    } catch {
      // keep compiled-in VERSION
    }
    console.log(`[harness] upgraded to v${v} - takes effect on next run`);
    return true;
  }
  if (
    root &&
    root.includes([path.sep + "Cellar", "agent-harness"].join(path.sep))
  ) {
    console.log(
      "[harness] brew install detected - run: brew upgrade agent-harness",
    );
    return true;
  }
  if (
    root &&
    root.includes([path.sep + "usr", "lib", "agent-harness"].join(path.sep))
  ) {
    console.log(
      "[harness] apt install detected - run: sudo apt update && sudo apt upgrade agent-harness",
    );
    return true;
  }
  console.log(`[harness] cannot self-update this install - run: ${NPM_MANUAL}`);
  return false;
}

// ---------- real inspection: everything below measures the disk ----------

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// ~4 chars per token for markdown. always printed with a ~ prefix.
export function estTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function fmtTok(t: number): string {
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`;
}

export function parseFrontmatter(
  text: string,
): { name: string; desc: string } | null {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!out.name || !out.description) return null;
  return { name: out.name, desc: out.description };
}

interface SkillInfo {
  name: string;
  file: string;
  tokens: number;
  desc: string;
  fmOk: boolean;
}

function listSkills(root: string): SkillInfo[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(path.join(root, "skills")).sort();
  } catch {
    return [];
  }
  const out: SkillInfo[] = [];
  for (const e of entries) {
    const f = path.join(root, "skills", e, "SKILL.md");
    const text = readText(f);
    if (text === null) continue;
    const fm = parseFrontmatter(text);
    out.push({
      name: e,
      file: f,
      tokens: estTokens(text),
      desc: fm?.desc ?? "",
      fmOk: !!fm,
    });
  }
  return out;
}

function listHooks(root: string): string[] {
  let groups: string[] = [];
  try {
    groups = fs.readdirSync(path.join(root, "instincts")).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const g of groups) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(root, "instincts", g)).sort();
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith(".sh")) out.push(path.join("instincts", g, f));
    }
  }
  return out;
}

interface AdapterInfo {
  name: string;
  json: Record<string, string> | null;
  error: string | null;
}

function listAdapters(root: string, sub = "adapters"): AdapterInfo[] {
  const base = path.join(root, sub);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(base).sort();
  } catch {
    return [];
  }
  const out: AdapterInfo[] = [];
  for (const e of entries) {
    const d = path.join(base, e);
    try {
      if (!fs.statSync(d).isDirectory()) continue;
    } catch {
      continue;
    }
    const text = readText(path.join(d, "adapter.json"));
    if (text === null) {
      out.push({ name: e, json: null, error: "missing adapter.json" });
      continue;
    }
    try {
      const json = JSON.parse(text);
      if (!json.name || !json.skillPath) {
        out.push({ name: e, json: null, error: "missing name/skillPath" });
      } else {
        out.push({ name: json.name, json, error: null });
      }
    } catch {
      out.push({ name: e, json: null, error: "invalid JSON" });
    }
  }
  return out;
}

function isExec(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function fmtMem(kb: number): string {
  const mb = kb / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`;
}

export interface OllamaRunner {
  pid: number;
  rssKb: number;
}

export interface OllamaState {
  runners: OllamaRunner[];
  totalKb: number;
  models: { name: string; sizeKb: number }[];
}

// installed-size table from /api/ps. exported for tests.
export function parseOllamaPs(
  text: string,
): { name: string; sizeKb: number }[] {
  try {
    const d: {
      models?: { name?: unknown; size_vram?: unknown; size?: unknown }[];
    } = JSON.parse(text);
    if (!Array.isArray(d.models)) return [];
    return d.models.map((m) => ({
      name: String(m.name ?? "?"),
      sizeKb: Math.round(Number(m.size_vram ?? m.size ?? 0) / 1024),
    }));
  } catch {
    return [];
  }
}

function ollamaApi(pathname: string): string | null {
  try {
    const r = spawnSync(
      "curl",
      ["-s", "-m", "5", `http://localhost:11434${pathname}`],
      {
        encoding: "utf8",
      },
    );
    if (r.status !== 0) return null;
    const body = typeof r.stdout === "string" ? r.stdout : "";
    return body ? body : null;
  } catch {
    return null;
  }
}

function rssOf(pid: number): number | null {
  try {
    const r = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], {
      encoding: "utf8",
    });
    if (r.status !== 0) return null;
    const n = parseInt(String(r.stdout ?? "").trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function runnerCmdline(pid: number): string | null {
  try {
    const r = spawnSync("ps", ["-o", "args=", "-p", String(pid)], {
      encoding: "utf8",
    });
    if (r.status !== 0) return null;
    return String(r.stdout ?? "");
  } catch {
    return null;
  }
}

// identity check, re-run immediately before every kill: pids can be
// recycled, so "matched a minute ago" is not proof enough to signal.
// strictly safer than pkill -f, which never rechecks.
function isOllamaRunner(pid: number): boolean {
  const args = runnerCmdline(pid);
  return (
    args !== null &&
    args.includes("llama-server") &&
    args.includes(".ollama/models")
  );
}

// resident ollama-managed runners only: other tools' llama-servers are
// never touched.
function ollamaRunnerPids(): number[] {
  let pids: number[] = [];
  try {
    const r = spawnSync("pgrep", ["-f", "llama-server"], { encoding: "utf8" });
    if (r.status !== 0) return [];
    pids = String(r.stdout ?? "")
      .split(/\s+/)
      .map(Number)
      .filter((n) => n > 0);
  } catch {
    return [];
  }
  return pids.filter(isOllamaRunner);
}

export function ollamaState(): OllamaState | null {
  const runners: OllamaRunner[] = [];
  for (const pid of ollamaRunnerPids()) {
    const rss = rssOf(pid);
    if (rss !== null) runners.push({ pid, rssKb: rss });
  }
  const psText = ollamaApi("/api/ps");
  if (runners.length === 0 && psText === null) return null;
  // /api/ps keeps listing models after their runners die externally, so
  // names are only shown when every listed model has a live runner.
  const listed =
    runners.length > 0 && psText !== null ? parseOllamaPs(psText) : [];
  const models = listed.length === runners.length ? listed : [];
  return {
    runners,
    totalKb: runners.reduce((t, r) => t + r.rssKb, 0),
    models,
  };
}

// SIGTERM, short grace, SIGKILL survivors. only ollama-managed runners;
// the server itself is never touched. every kill re-verifies identity
// first, and runners that survive everything are excluded from the freed
// total (reported as stuck). the next inference reloads transparently.
export function unloadOllamaRunners(): {
  freedKb: number;
  count: number;
  stuck: number;
} {
  const held = new Map<number, number>();
  for (const pid of ollamaRunnerPids()) {
    if (!isOllamaRunner(pid)) continue;
    const rss = rssOf(pid) ?? 0;
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      continue;
    }
    held.set(pid, rss);
  }
  if (held.size === 0) return { freedKb: 0, count: 0, stuck: 0 };
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 3000;
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  let pending = [...held.keys()].filter(alive);
  while (pending.length > 0 && Date.now() < deadline) {
    Atomics.wait(wait, 0, 0, 100);
    pending = pending.filter(alive);
  }
  for (const pid of pending) {
    if (!isOllamaRunner(pid)) {
      held.delete(pid);
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      held.delete(pid);
    }
  }
  Atomics.wait(wait, 0, 0, 500);
  let freed = 0;
  let count = 0;
  let stuck = 0;
  for (const [pid, rss] of held) {
    if (alive(pid) && isOllamaRunner(pid)) {
      stuck += 1;
      continue;
    }
    freed += rss;
    count += 1;
  }
  return { freedKb: freed, count, stuck };
}

function timeMs(fn: () => void): number {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function runHook(
  abs: string,
  timeoutMs: number,
): { ms: number; status: number | null } {
  const t0 = process.hrtime.bigint();
  const r = spawnSync("bash", [abs], {
    input: "",
    timeout: timeoutMs,
    stdio: ["pipe", "ignore", "ignore"],
  });
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: r.status };
}

const AUTO_MARKERS: Record<string, string> = {
  claude: ".claude",
  cursor: ".cursor",
  opencode: "opencode.json",
  "kiro-cli": ".kiro",
  "kiro-desktop": ".kiro",
  aider: ".aider.conf.yml",
  cline: ".clinerules",
  codex: ".agents",
  generic: "",
};

export function stripFm(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "");
}

// first "# comment" line of a hook script (shebang excluded by the space).
function hookBlurb(root: string, rel: string): string {
  const text = readText(path.join(root, rel));
  if (text === null) return rel;
  for (const line of text.split("\n")) {
    const m = /^# (.+)/.exec(line);
    if (m) return m[1];
  }
  return rel;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const OPENCODE_PLUGIN = `// harness opencode plugin: wires .harness/hooks into tool events.
// guard blocks by throwing (opencode plugin pattern); check runs best-effort.
import { spawnSync } from "node:child_process";
import path from "node:path";

function runHook(directory, script, input) {
  const r = spawnSync("bash", [path.join(directory, ".harness", "hooks", script)], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    timeout: 10000,
    cwd: directory,
  });
  return typeof r.status === "number" ? r.status : 1;
}

export const HarnessPlugin = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    // opencode passes the command in the second arg (output.args); the first
    // arg carries only tool/session/call IDs.
    const args = (output && output.args) || {};
    const seen = { tool: input && input.tool, args };
    if (runHook(directory, "pre-tool--guard.sh", seen) === 2) {
      throw new Error("Blocked by harness guard (possible prompt injection or secret).");
    }
  },
  "tool.execute.after": async () => {
    runHook(directory, "post-edit--check.sh");
  },
});
`;

function cmdInit(flags: string[]): boolean {
  const root = selfRoot();
  if (!root) {
    console.log("[harness] init - cannot locate install");
    return false;
  }
  const migrate = flags.includes("--migrate");
  const dry = flags.includes("--dry-run");
  const forceAll = flags.includes("--force");
  const hi = flags.indexOf("--harness");
  if (hi !== -1 && !flags[hi + 1]) {
    console.log("[harness] init - --harness needs a name (harness init --harness claude)");
    return false;
  }
  const explicit =
    hi !== -1
      ? (flags[hi + 1] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const cwd = process.cwd();
  const manFile = path.join(cwd, ".harness", "config.json");
  const prior = readText(manFile);
  if (prior !== null && !migrate && !dry && !forceAll) {
    console.log(
      "[harness] init - already initialized here (use --migrate to fill gaps)",
    );
    return false;
  }
  const adapters = listAdapters(root).filter((a) => a.json);
  const byName = new Map(adapters.map((a) => [a.name, a]));
  for (const c of listAdapters(
    process.cwd(),
    path.join(".harness", "adapters"),
  )) {
    if (c.json) byName.set(c.name, c);
  }
  let priorHarness: string[] = [];
  try {
    if (prior !== null) {
      priorHarness = (JSON.parse(prior).harness ?? []).filter((n: string) =>
        byName.has(n),
      );
    }
  } catch {
    // corrupt manifest: autodetect below, rewrite after
  }
  let names: string[];
  if (explicit.length > 0) {
    const unknown = explicit.filter((n) => !byName.has(n));
    if (unknown.length > 0) {
      console.log(
        `[harness] init - unknown harness: ${unknown.join(", ")} (try: harness adapter list)`,
      );
      return false;
    }
    names = explicit;
  } else if (migrate && priorHarness.length > 0) {
    names = priorHarness;
  } else {
    names = adapters
      .map((a) => a.name)
      .filter((n) => {
        const m = AUTO_MARKERS[n] ?? "";
        return m !== "" && fs.existsSync(path.join(process.cwd(), m));
      });
  }
  const tracked = new Set<string>();
  const priorFiles: Array<string | { path: string; sha: string }> = [];
  if (prior !== null) {
    try {
      const parsed = JSON.parse(prior).files ?? [];
      for (const f of parsed) {
        priorFiles.push(f);
        tracked.add(typeof f === "string" ? f : f.path);
      }
    } catch {
      // corrupt manifest: rewrite below
    }
  }
  const written: Array<{ rel: string; sha: string }> = [];
  const skipped: string[] = [];
  const planned: Array<{
    rel: string;
    action: "write" | "overwrite" | "skip";
  }> = [];
  const recorded = new Map<string, string>();
  for (const f of priorFiles) {
    if (typeof f !== "string") recorded.set(f.path, f.sha);
  }
  const put = (rel: string, content: string, exec = false, force = false) => {
    const abs = path.join(cwd, rel);
    const exists = fs.existsSync(abs);
    const overwriting = force || forceAll;
    if (dry) {
      const action = !exists ? "write" : overwriting ? "overwrite" : "skip";
      planned.push({ rel, action });
      if (action === "skip") skipped.push(rel);
      else written.push({ rel, sha: sha256(content) });
      return;
    }
    if (!overwriting && exists) {
      skipped.push(rel);
      return;
    }
    if (overwriting && exists && !force) {
      // --force reinstalls what init owns, never your edits: a tracked
      // file whose content drifted from its recorded hash is left alone.
      const want = recorded.get(rel);
      if (want !== undefined) {
        const cur = readText(abs);
        if (cur !== null && sha256(cur) !== want) {
          console.log(
            `[harness] init - ${rel} edited by you, keeping (delete it to force overwrite)`,
          );
          skipped.push(rel);
          return;
        }
      }
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      if (exec) fs.chmodSync(abs, 0o755);
      written.push({ rel, sha: sha256(content) });
    } catch {
      console.log(`[harness] init - could not write ${rel}`);
    }
  };
  const opts = readOptimizations(cwd);
  const agentsSrc =
    opts["slim-agents"] === false
      ? readText(path.join(root, "AGENTS.md"))
      : (readText(path.join(root, "templates", "AGENTS.project.md")) ??
        readText(path.join(root, "AGENTS.md")));
  const memSrc = readText(path.join(root, "memory", "MEMORY.md"));
  const dests = new Map<string, string>();
  if (agentsSrc !== null) dests.set("AGENTS.md", agentsSrc);
  if (memSrc !== null) dests.set("MEMORY.md", memSrc);
  for (const n of names) {
    const j = byName.get(n)!.json!;
    if (j.memoryPath && memSrc !== null) dests.set(j.memoryPath, memSrc);
    if (j.agentsPath && agentsSrc !== null) dests.set(j.agentsPath, agentsSrc);
  }
  for (const [rel, content] of dests) put(rel, content);
  const bodies = new Map<string, string>();
  for (const s of listSkills(root)) {
    const t = readText(s.file);
    if (t !== null) bodies.set(s.name, t);
  }
  const hooks = listHooks(root);
  for (const n of names) {
    const sp = byName.get(n)!.json!.skillPath;
    if (!sp) {
      console.log(
        `[harness] init - ${n}: fill in skillPath in its adapter.json first`,
      );
      continue;
    }
    if (n === "cursor") {
      // Cursor ignores plain .md here: .mdc + description/alwaysApply = agent-requested.
      for (const [name, body] of bodies) {
        const desc = (parseFrontmatter(body)?.desc ?? name).replace(
          /\s+/g,
          " ",
        );
        put(
          `${sp}/${name}.mdc`,
          `---\ndescription: ${desc}\nalwaysApply: false\n---\n\n${stripFm(body)}\n`,
        );
      }
    } else if (n === "kiro-desktop") {
      // flat steering files with inclusion:auto, verified against Kiro steering doc.
      for (const [name, body] of bodies) {
        const desc = (parseFrontmatter(body)?.desc ?? name).replace(
          /\s+/g,
          " ",
        );
        put(
          `${sp}/${name}.md`,
          `---\ninclusion: auto\nname: ${name}\ndescription: ${desc}\n---\n\n${stripFm(body)}\n`,
        );
      }
    } else if (n === "cline") {
      // .clinerules/ holds flat .md rules, no frontmatter = always active.
      for (const [name, body] of bodies) {
        put(`${sp}/${name}.md`, `# ${name}\n\n${stripFm(body)}\n`);
      }
      const lines = hooks.map((h) => `- \`${h}\`: ${hookBlurb(root, h)}`);
      put(
        `${sp}/00-harness-instincts.md`,
        `# Harness instincts\n\nThis project has no hooks system. Before finishing a task, run these checks yourself:\n\n${lines.join("\n")}\n`,
      );
    } else if (sp.endsWith(".md")) {
      const content =
        [...bodies.entries()]
          .map(([name, body]) => `# ${name}\n\n${body}`)
          .join("\n\n---\n\n") + "\n";
      put(sp, content);
    } else {
      for (const [name, body] of bodies) put(`${sp}/${name}/SKILL.md`, body);
    }
  }
  if (names.includes("aider")) {
    // verified shape: aider loads files listed under read:.
    if (!fs.existsSync(path.join(cwd, ".aider.conf.yml"))) {
      put(
        ".aider.conf.yml",
        "# written by harness init\nread: CONVENTIONS.md\n",
      );
    } else if (!tracked.has(".aider.conf.yml")) {
      console.log(
        "[harness] init - .aider.conf.yml exists, add read: CONVENTIONS.md manually",
      );
    }
  }
  const copied: string[] = [];
  const copyHook = (rel: string) => {
    const text = readText(path.join(root, rel));
    if (text === null) return;
    const base = `${path.basename(path.dirname(rel))}--${path.basename(rel)}`;
    put(`.harness/hooks/${base}`, text, true);
    copied.push(base);
  };
  for (const h of hooks) copyHook(h);
  copyHook("security/audit.sh");
  if (names.includes("claude")) {
    const rel = ".claude/settings.json";
    if (!fs.existsSync(path.join(cwd, rel))) {
      const entry = (base: string, matcher: string, timeout: number) => ({
        matcher,
        hooks: [
          { type: "command", command: `./.harness/hooks/${base}`, timeout },
        ],
      });
      const find = (sfx: string) => copied.find((c) => c.endsWith(sfx));
      const hj: Record<string, unknown> = {};
      const hyd = find("session-start--hydrate.sh");
      const grd = find("pre-tool--guard.sh");
      const chk = find("post-edit--check.sh");
      // seconds per the Claude Code hooks spec; the staged scan is served by
      // `harness security` (there is no pre-commit tool event to wire).
      if (hyd) hj.SessionStart = [entry(hyd, "*", 15)];
      if (grd) hj.PreToolUse = [entry(grd, "Bash|Edit|Write", 5)];
      if (chk) hj.PostToolUse = [entry(chk, "Edit|Write", 5)];
      put(rel, JSON.stringify({ hooks: hj }, null, 2) + "\n");
    } else if (!tracked.has(rel)) {
      console.log(
        "[harness] init - .claude/settings.json exists, merge hooks manually (see docs/cli.md)",
      );
    }
  }
  const findHook = (sfx: string) => copied.find((c) => c.endsWith(sfx));
  if (names.includes("cursor")) {
    // verified: .cursor/hooks.json v1, exit 2 blocks, seconds, project-root cwd.
    const rel = ".cursor/hooks.json";
    if (!fs.existsSync(path.join(cwd, rel))) {
      const entry = (base: string, timeout: number) => ({
        command: `.harness/hooks/${base}`,
        timeout,
      });
      const hj: Record<string, unknown[]> = {};
      const hyd = findHook("session-start--hydrate.sh");
      const grd = findHook("pre-tool--guard.sh");
      const chk = findHook("post-edit--check.sh");
      if (hyd) hj.sessionStart = [entry(hyd, 15)];
      if (grd) hj.preToolUse = [entry(grd, 5)];
      if (chk) hj.afterFileEdit = [entry(chk, 5)];
      put(rel, JSON.stringify({ version: 1, hooks: hj }, null, 2) + "\n");
    } else if (!tracked.has(rel)) {
      console.log(
        "[harness] init - .cursor/hooks.json exists, merge hooks manually (see docs/cli.md)",
      );
    }
  }
  if (names.includes("kiro-cli") || names.includes("kiro-desktop")) {
    // verified: .kiro/hooks/*.json v1 schema, seconds, project-root cwd.
    const kh = (
      nm: string,
      trigger: string,
      base: string,
      timeout: number,
    ) => ({
      name: nm,
      trigger,
      action: {
        type: "command",
        command: `./.harness/hooks/${base}`,
      },
      timeout,
    });
    const hyd = findHook("session-start--hydrate.sh");
    const grd = findHook("pre-tool--guard.sh");
    const chk = findHook("post-edit--check.sh");
    if (hyd) {
      put(
        ".kiro/hooks/session-hydrate.json",
        JSON.stringify(
          {
            version: "v1",
            hooks: [
              kh("harness hydrate on session start", "SessionStart", hyd, 15),
              kh("harness hydrate on agent spawn", "Agent Spawn", hyd, 15),
            ],
          },
          null,
          2,
        ) + "\n",
      );
    }
    if (grd) {
      put(
        ".kiro/hooks/pre-tool-guard.json",
        JSON.stringify(
          {
            version: "v1",
            hooks: [kh("harness pre-tool guard", "Pre Tool Use", grd, 5)],
          },
          null,
          2,
        ) + "\n",
      );
    }
    if (chk) {
      put(
        ".kiro/hooks/post-tool-check.json",
        JSON.stringify(
          {
            version: "v1",
            hooks: [kh("harness post-edit check", "Post Tool Use", chk, 5)],
          },
          null,
          2,
        ) + "\n",
      );
    }
  }
  if (names.includes("opencode")) {
    // verified: local plugins in .opencode/plugins/*.js, throw-to-block.
    const rel = ".opencode/plugins/harness.js";
    if (!fs.existsSync(path.join(cwd, rel))) {
      put(rel, OPENCODE_PLUGIN);
    }
  }
  if (names.includes("codex")) {
    // verified: <repo>/.codex/hooks.json, exit 2 + stderr blocks, seconds.
    // commands resolve from the git root (codex may start in a subdirectory).
    const rel = ".codex/hooks.json";
    if (!fs.existsSync(path.join(cwd, rel))) {
      const root = '"$(git rev-parse --show-toplevel)"';
      const entry = (matcher: string, base: string, timeout: number) => ({
        matcher,
        hooks: [
          {
            type: "command",
            command: `bash ${root}/.harness/hooks/${base}`,
            timeout,
          },
        ],
      });
      const hj: Record<string, unknown> = {};
      const hyd = findHook("session-start--hydrate.sh");
      const grd = findHook("pre-tool--guard.sh");
      const chk = findHook("post-edit--check.sh");
      if (hyd) hj.SessionStart = [entry("startup|resume", hyd, 15)];
      if (grd) hj.PreToolUse = [entry("Bash", grd, 5)];
      if (chk) hj.PostToolUse = [entry("Bash", chk, 5)];
      put(rel, JSON.stringify({ hooks: hj }, null, 2) + "\n");
    } else if (!tracked.has(rel)) {
      console.log(
        "[harness] init - .codex/hooks.json exists, merge hooks manually (see docs/cli.md); review new hooks with /hooks on first run",
      );
    }
  }
  if (opts["map-index"] !== false) {
    // generated index: always refreshed, even on --migrate.
    const m = buildMap(cwd);
    put(".harness/MAP.md", m.text, false, true);
    console.log(
      `[harness] init - map: ${m.files} files, ~${fmtTok(m.tokens)} tokens${m.omitted > 0 ? ` (${m.omitted} omitted, capped at ${MAP_MAX_FILES})` : ""}`,
    );
  }
  const files = [
    ...priorFiles,
    ...written.map((w) => ({ path: w.rel, sha: w.sha })),
  ];
  // migrate re-records regenerated files (MAP.md): keep the latest entry per path.
  const seenPaths = new Set<string>();
  const deduped = files
    .reverse()
    .filter((f) => {
      const p = typeof f === "string" ? f : f.path;
      if (seenPaths.has(p)) return false;
      seenPaths.add(p);
      return true;
    })
    .reverse();
  let priorOpts: Record<string, unknown> = {};
  try {
    if (prior !== null) priorOpts = JSON.parse(prior).optimizations ?? {};
  } catch {
    // corrupt manifest: defaults below
  }
  const optimizations: Record<string, boolean> = { ...defaultOptimizations() };
  for (const o of OPTIMIZATIONS) {
    if (typeof priorOpts[o.name] === "boolean")
      optimizations[o.name] = priorOpts[o.name] as boolean;
  }
  const scope = names.length > 0 ? names.join(",") : "core only";
  if (dry) {
    const mark = (a: string) =>
      a === "write" ? "+" : a === "overwrite" ? "!" : "=";
    console.log(`[harness] init ${scope} - dry run: nothing written`);
    for (const p of planned) console.log(`  ${mark(p.action)} ${p.rel}`);
    console.log(
      `[harness] init - would write .harness/config.json (${deduped.length} files tracked)`,
    );
    return true;
  }
  try {
    fs.mkdirSync(path.dirname(manFile), { recursive: true });
    fs.writeFileSync(
      manFile,
      JSON.stringify(
        {
          version: VERSION,
          harness: names,
          files: deduped,
          optimizations,
          ts: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch {
    console.log("[harness] init - could not write .harness/config.json");
    return false;
  }
  console.log(
    `[harness] init ${scope} - ${written.length} written, ${skipped.length} skipped (run harness doctor to verify)`,
  );
  return true;
}

function cmdBench(flags: string[]): boolean {
  const root = selfRoot();
  if (!root) {
    console.log("[harness] bench - cannot locate install");
    return false;
  }
  const quick = flags.includes("--quick");
  const compare = flags.includes("--compare");
  const runs = quick ? 1 : 3;
  console.log(
    `[harness] bench - ${runs} run${runs > 1 ? "s" : ""} per hook (tokens are estimates, ~4 chars each)`,
  );
  let ok = true;
  const self = fs.realpathSync(fileURLToPath(import.meta.url));
  let cold = 0;
  cold = timeMs(() => {
    spawnSync(process.execPath, [self, "--version"], { stdio: "ignore" });
  });
  const coldOk = cold < 1500;
  if (!coldOk) ok = false;
  console.log(
    `  cold-start ${Math.round(cold)}ms (want <1500ms) ${coldOk ? "ok" : "FAIL"}`,
  );
  const hooks = listHooks(root);
  if (hooks.length === 0) {
    console.log("  hooks: none found FAIL");
    ok = false;
  }
  const hookMs: Record<string, number> = {};
  for (const h of hooks) {
    let total = 0;
    let status: number | null = 0;
    for (let i = 0; i < runs; i++) {
      const r = runHook(path.join(root, h), 10000);
      total += r.ms;
      if (r.status !== 0) status = r.status;
    }
    const mean = total / runs;
    hookMs[h] = Math.round(mean * 10) / 10;
    const good = status === 0;
    if (!good) ok = false;
    const mark = !good ? "FAIL" : mean > 2000 ? "slow" : "ok";
    console.log(
      `  hook ${path.basename(h)} mean ${mean.toFixed(0)}ms exit ${status} ${mark}`,
    );
  }
  const skills = listSkills(root);
  const totalTok = skills.reduce((a, s) => a + s.tokens, 0);
  const skillsOk = skills.length > 0 && totalTok < 50000;
  if (!skillsOk) ok = false;
  for (const s of skills) console.log(`  skill ${s.name} ~${fmtTok(s.tokens)}`);
  console.log(
    `  skills ${skills.length} files ~${fmtTok(totalTok)} (want <50k) ${skillsOk ? "ok" : "FAIL"}`,
  );
  let adapters: AdapterInfo[] = [];
  let valid = 0;
  const adapterMs = timeMs(() => {
    adapters = listAdapters(root);
    valid = adapters.filter((a) => a.json).length;
  });
  const adOk = adapters.length > 0 && valid === adapters.length;
  if (!adOk) ok = false;
  for (const a of adapters) {
    if (!a.json) console.log(`  adapter ${a.name}: ${a.error} FAIL`);
  }
  console.log(
    `  adapters ${valid}/${adapters.length} valid in ${adapterMs.toFixed(0)}ms ${adOk ? "ok" : "FAIL"}`,
  );
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const ol = ollamaState();
  const ollama =
    ol === null
      ? null
      : {
          runners: ol.runners.length,
          rssKb: ol.totalKb,
          models: ol.models.map((m) => m.name),
        };
  if (ol === null) {
    console.log("  ollama: no local server detected");
  } else {
    console.log(
      `  ollama ${ol.runners.length} resident ~${fmtMem(ol.totalKb)}${ol.models.length > 0 ? ` (${ol.models.map((m) => m.name).join(", ")})` : ""}`,
    );
  }
  const baseline = {
    version: VERSION,
    ts: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    runtime: process.version,
    coldStartMs: r1(cold),
    hooks: hookMs,
    skillTokens: totalTok,
    adapterMs: r1(adapterMs),
    ollama,
  };
  const bFile = path.join(process.cwd(), ".harness", "bench.json");
  if (compare) {
    const prev = readText(bFile);
    if (prev === null) {
      console.log("  compare: no baseline yet, saving current");
    } else {
      try {
        const p = JSON.parse(prev);
        const d = (c: number, o: number) => {
          const diff = r1(c - o);
          return `${c} (was ${o}, ${diff > 0 ? "+" : ""}${diff})`;
        };
        console.log(
          `  compare cold-start ${d(baseline.coldStartMs, p.coldStartMs)}ms`,
        );
        for (const h of Object.keys(hookMs)) {
          if (p.hooks?.[h] !== undefined) {
            console.log(
              `  compare hook ${path.basename(h)} ${d(hookMs[h], p.hooks[h])}ms`,
            );
          }
        }
        if (p.skillTokens !== undefined) {
          console.log(
            `  compare skills ~${fmtTok(totalTok)} (was ~${fmtTok(p.skillTokens)})`,
          );
        }
      } catch {
        console.log("  compare: baseline corrupt, overwriting");
      }
    }
  }
  try {
    fs.mkdirSync(path.dirname(bFile), { recursive: true });
    fs.writeFileSync(bFile, JSON.stringify(baseline, null, 2));
    console.log("[harness] baseline saved to .harness/bench.json");
  } catch {
    console.log("[harness] warn - could not write .harness/bench.json");
  }
  return ok;
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]+/,
  /xox[bap]-[A-Za-z0-9-]+/,
];

function scanStaged(): { file: string; line: number }[] {
  const hits: { file: string; line: number }[] = [];
  let out = "";
  try {
    const r = spawnSync("git", ["diff", "--cached", "--no-color"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    out = typeof r.stdout === "string" ? r.stdout : "";
  } catch {
    return hits;
  }
  let file = "";
  let line = 0;
  let inHunk = false;
  for (const l of out.split("\n")) {
    const m = /^\+\+\+ b\/(.+)/.exec(l);
    if (m) {
      file = m[1];
      line = 0;
      inHunk = false;
      continue;
    }
    // hunk headers carry the real new-file line number; context lines
    // advance it too, or reported positions drift into wrong code.
    const hm = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (hm) {
      line = Number(hm[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (l.startsWith("+") && !l.startsWith("+++")) {
      if (SECRET_PATTERNS.some((p) => p.test(l))) hits.push({ file, line });
      line += 1;
    } else if (l.startsWith(" ")) {
      line += 1;
    }
  }
  return hits;
}

function fmtAge(ts: string): string {
  const ago = Date.now() - Date.parse(ts);
  if (!isFinite(ago) || ago < 0) return "unknown age";
  const min = Math.floor(ago / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// project snapshot: init state, memory, findings, baseline, install.
// reads only; never fails, missing pieces are reported as missing.
function guiProjectStats(): Record<string, unknown> {
  // Read-only, cheap snapshot for the gui overview page. Never throws.
  const cwd = process.cwd();
  const out: Record<string, unknown> = {};
  try {
    const hDir = path.join(cwd, ".harness");
    out.initialized = fs.existsSync(path.join(hDir, "config.json"))
      ? "yes"
      : fs.existsSync(hDir)
        ? "partial"
        : "no";
  } catch {
    out.initialized = "no";
  }
  try {
    const mem = readText(path.join(cwd, "MEMORY.md"));
    out.memTokens = mem === null ? null : Math.round(estTokens(mem));
  } catch {
    out.memTokens = null;
  }
  try {
    out.skills = fs
      .readdirSync(path.join(cwd, "skills"), { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          fs.existsSync(path.join(cwd, "skills", e.name, "SKILL.md")),
      ).length;
  } catch {
    out.skills = 0;
  }
  try {
    out.findings = fs
      .readdirSync(path.join(cwd, "research", "findings"))
      .filter((f) => f.endsWith(".md")).length;
  } catch {
    out.findings = 0;
  }
  try {
    const b = JSON.parse(
      readText(path.join(cwd, ".harness", "bench.json")) ?? "",
    );
    out.lastBench = typeof b.ts === "string" ? fmtAge(b.ts) : null;
  } catch {
    out.lastBench = null;
  }
  try {
    const opts = readOptimizations(cwd);
    out.optimizationsOn = OPTIMIZATIONS.filter((o) => opts[o.name]).length;
    out.optimizationsTotal = OPTIMIZATIONS.length;
  } catch {
    out.optimizationsOn = 0;
    out.optimizationsTotal = OPTIMIZATIONS.length;
  }
  try {
    const ol = ollamaState();
    out.localModels =
      ol === null
        ? null
        : { runners: ol.runners.length, mem: fmtMem(ol.totalKb) };
  } catch {
    out.localModels = null;
  }
  return out;
}

let mainShaCache: { at: number; sha: string | null } | null = null;
const MAIN_SHA_TTL_MS = 60000;

async function cachedMainSha(): Promise<string | null> {
  const now = Date.now();
  if (mainShaCache && now - mainShaCache.at < MAIN_SHA_TTL_MS) {
    return mainShaCache.sha;
  }
  const sha = await resolveMainSha();
  mainShaCache = { at: now, sha };
  return sha;
}

function gitOut(args: string[]): string | null {
  try {
    const r = spawnSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status !== 0 || typeof r.stdout !== "string") return null;
    const s = r.stdout.trim();
    return s ? s.slice(0, 500) : null;
  } catch {
    return null;
  }
}

async function guiUpdateInfo(): Promise<Record<string, unknown>> {
  // Read-only version/build snapshot for the gui Update panel. Never throws.
  const out: Record<string, unknown> = {
    version: VERSION,
    node: process.version,
  };
  try {
    out.commit = gitOut(["rev-parse", "HEAD"]);
    out.short = gitOut(["rev-parse", "--short", "HEAD"]);
    out.branch = gitOut(["branch", "--show-current"]);
    out.committed = gitOut(["log", "-1", "--format=%ci"]);
    out.subject = gitOut(["log", "-1", "--format=%s"]);
    const dirty = gitOut(["status", "--porcelain"]);
    out.dirty = dirty === null ? null : dirty.length > 0;
    try {
      out.built = fs.statSync(process.argv[1] ?? "").mtime.toISOString();
    } catch {
      out.built = null;
    }
    // Live freshness: compare local checkout against main (git) when possible.
    // resolveMainSha is cached 60s: the pill + modal hit this endpoint
    // back-to-back, and must not stack 10s stalls when github is down.
    try {
      if (typeof out.commit === "string" && out.commit.length === 40) {
        const main = await cachedMainSha();
        if (main) {
          out.latest = main.slice(0, 7);
          out.behind =
            typeof out.short === "string"
              ? out.short !== main.slice(0, 7)
              : null;
        } else {
          out.latest = null;
          out.behind = null;
        }
      } else {
        out.latest = null;
        out.behind = null;
      }
    } catch {
      out.latest = null;
      out.behind = null;
    }
    // System + license facts for the gui About page. Read-only, never throws.
    try {
      out.sys = {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        totalGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
        cpus: os.cpus().length,
      };
    } catch {
      out.sys = null;
    }
    try {
      const root = selfRoot();
      const licPath = root ? path.join(root, "LICENSE") : "";
      const text =
        licPath && fs.existsSync(licPath)
          ? fs.readFileSync(licPath, "utf8").slice(0, 4000)
          : "";
      let spdx = "";
      try {
        spdx = root
          ? (JSON.parse(
              fs.readFileSync(path.join(root, "package.json"), "utf8"),
            ).license ?? "")
          : "";
      } catch {
        spdx = "";
      }
      out.license = { spdx, text };
    } catch {
      out.license = { spdx: "", text: "" };
    }
  } catch {
    // keep version + node
  }
  return out;
}

function cmdStatus(): boolean {
  const cwd = process.cwd();
  const hDir = path.join(cwd, ".harness");
  console.log("[harness] status");
  console.log("Project");
  const initState = fs.existsSync(path.join(hDir, "config.json"))
    ? "yes"
    : fs.existsSync(hDir)
      ? "partial (.harness/ without config.json)"
      : "no";
  console.log(
    `  initialized: ${initState}${initState === "no" ? " (run harness init)" : ""}`,
  );
  const mem = readText(path.join(cwd, "MEMORY.md"));
  console.log(
    mem === null
      ? "  MEMORY.md: missing"
      : `  MEMORY.md: ~${fmtTok(estTokens(mem))} tokens`,
  );
  let findings = 0;
  try {
    findings = fs
      .readdirSync(path.join(cwd, "research", "findings"))
      .filter((f) => f.endsWith(".md")).length;
  } catch {
    // no findings dir
  }
  console.log(`  research findings: ${findings}`);
  const bText = readText(path.join(hDir, "bench.json"));
  if (bText === null) {
    console.log("  last benchmark: none yet (run harness bench)");
  } else {
    try {
      const b = JSON.parse(bText);
      const cold =
        typeof b.coldStartMs === "number"
          ? `, cold-start ${b.coldStartMs}ms`
          : "";
      console.log(`  last benchmark: ${fmtAge(b.ts)}${cold}`);
    } catch {
      console.log("  last benchmark: baseline corrupt (run harness bench)");
    }
  }
  const opts = readOptimizations(cwd);
  const on = OPTIMIZATIONS.filter((o) => opts[o.name]).length;
  console.log(`  optimizations: ${on}/${OPTIMIZATIONS.length} on`);
  const ol = ollamaState();
  if (ol === null) {
    console.log("  local models: ollama not detected");
  } else {
    const names = ol.models.map((m) => m.name).join(", ");
    console.log(
      `  local models: ${ol.runners.length} resident ~${fmtMem(ol.totalKb)}${names ? ` (${names})` : ""}`,
    );
  }
  const root = selfRoot();
  if (root === null) {
    console.log("[harness] status - cannot locate install");
    return true;
  }
  console.log("Install");
  console.log(`  version: ${VERSION}`);
  const skills = listSkills(root);
  console.log(
    `  skills: ${skills.length} (~${fmtTok(skills.reduce((t, s) => t + s.tokens, 0))} tokens)`,
  );
  const hooks = listHooks(root);
  console.log(
    `  hooks: ${hooks.length} (${hooks.filter((h) => isExec(path.join(root, h))).length} executable)`,
  );
  const adapters = listAdapters(root);
  console.log(
    `  adapters: ${adapters.filter((a) => a.json).length}/${adapters.length} valid`,
  );
  return true;
}

function cmdDoctor(flags: string[]): boolean {
  const root = selfRoot();
  if (!root) {
    console.log("[harness] doctor - cannot locate install");
    return false;
  }
  const fix = flags.includes("--fix");
  const strict = flags.includes("--strict");
  const json = flags.includes("--json");
  let ok = true;
  const jFails: string[] = [];
  const jWarns: string[] = [];
  const fail = (s: string) => {
    ok = false;
    if (json) {
      jFails.push(s);
      return;
    }
    console.log(s);
  };
  const warn = (s: string) => {
    if (json) {
      jWarns.push(s);
      if (strict) ok = false;
      return;
    }
    console.log(s);
    if (strict) ok = false;
  };
  // machine-readable mode: info lines would corrupt the JSON, so only
  // the final object reaches stdout (fail/warn already captured above).
  const realLog = console.log.bind(console);
  if (json) console.log = () => {};
  const skills = listSkills(root);
  const badFm = skills.filter((s) => !s.fmOk).map((s) => s.name);
  if (skills.length === 0) fail("[harness] FAIL - skills: none found");
  else if (badFm.length > 0) {
    fail(
      `[harness] FAIL - skills frontmatter missing name/description: ${badFm.join(", ")}`,
    );
  } else {
    console.log(
      `[harness] ok - skills: ${skills.length} checked, frontmatter ok`,
    );
  }
  const hooks = listHooks(root);
  const perfOff = readDisabledByPerf(process.cwd());
  const noexec = hooks.filter((h) => !isExec(path.join(root, h)));
  const skippedPerf = noexec.filter((h) => perfOff.has(h));
  const repairable = noexec.filter((h) => !perfOff.has(h));
  if (skippedPerf.length > 0) {
    console.log(
      `[harness] info - left disabled by optimize: ${skippedPerf.join(", ")}`,
    );
  }
  if (repairable.length > 0) {
    if (fix) {
      let repaired = 0;
      for (const h of repairable) {
        try {
          fs.chmodSync(path.join(root, h), 0o755);
          if (isExec(path.join(root, h))) repaired += 1;
        } catch {
          // keep going
        }
      }
      const still = hooks.filter(
        (h) => !isExec(path.join(root, h)) && !perfOff.has(h),
      );
      if (still.length === 0) {
        console.log(
          `[harness] ok - hooks: repaired exec on ${repaired}, ${hooks.length - skippedPerf.length} executable`,
        );
      } else {
        fail(`[harness] FAIL - hooks not executable: ${still.join(", ")}`);
      }
    } else {
      fail(
        `[harness] FAIL - hooks not executable (run --fix): ${repairable.join(", ")}`,
      );
    }
  } else if (hooks.length === 0) {
    fail("[harness] FAIL - hooks: none found");
  } else {
    console.log(
      `[harness] ok - hooks: ${hooks.length - skippedPerf.length} executable${skippedPerf.length > 0 ? ` (${skippedPerf.length} disabled by optimize)` : ""}`,
    );
  }
  const adapters = listAdapters(root);
  const bad = adapters.filter((a) => !a.json);
  if (adapters.length === 0) fail("[harness] FAIL - adapters: none found");
  else if (bad.length > 0) {
    fail(
      `[harness] FAIL - adapters invalid: ${bad.map((a) => `${a.name} (${a.error})`).join(", ")}`,
    );
  } else {
    console.log(
      `[harness] ok - adapters: ${adapters.length}/${adapters.length} valid`,
    );
  }
  const tplBad: string[] = [];
  for (const a of adapters) {
    if (!a.json || !a.json.transpile || !/^[a-z0-9-]+$/.test(a.name)) continue;
    const f = path.join(root, "adapters", a.name, "transpile.sh");
    if (!fs.existsSync(f)) {
      tplBad.push(`${a.name} (missing transpile.sh)`);
      continue;
    }
    if (!isExec(f)) {
      if (fix) {
        try {
          fs.chmodSync(f, 0o755);
        } catch {
          // keep going
        }
      }
      if (!isExec(f)) tplBad.push(`${a.name} (transpile.sh not executable)`);
    }
  }
  if (tplBad.length > 0) {
    fail(`[harness] FAIL - adapter transpilers: ${tplBad.join(", ")}`);
  } else if (adapters.some((a) => a.json && a.json.transpile)) {
    console.log("[harness] ok - adapter transpilers executable");
  }
  const manText = readText(path.join(process.cwd(), ".harness", "config.json"));
  if (manText !== null) {
    try {
      const files: Array<string | { path: string; sha: string }> =
        JSON.parse(manText).files ?? [];
      const relOf = (f: string | { path: string; sha: string }) =>
        typeof f === "string" ? f : f.path;
      const missing = files
        .map(relOf)
        .filter((f) => !fs.existsSync(path.join(process.cwd(), f)));
      const modified: string[] = [];
      for (const f of files) {
        if (typeof f === "string") continue;
        const abs = path.join(process.cwd(), f.path);
        if (!fs.existsSync(abs)) continue;
        const text = readText(abs);
        if (text !== null && sha256(text) !== f.sha) modified.push(f.path);
      }
      if (missing.length > 0) {
        fail(
          `[harness] FAIL - project init files missing: ${missing.join(", ")}`,
        );
      }
      if (modified.length > 0) {
        fail(
          `[harness] FAIL - project files modified: ${modified.join(", ")} (delete + migrate to restore, or keep your edit)`,
        );
      }
      if (missing.length === 0 && modified.length === 0) {
        console.log(
          `[harness] ok - project: ${files.length}/${files.length} init files present, hashes match`,
        );
      }
      const { added } = readAddedSkills(process.cwd());
      const addedBad: string[] = [];
      for (const a of added) {
        const reason = verifyAddedSkill(process.cwd(), a);
        if (reason) addedBad.push(reason);
      }
      if (addedBad.length > 0) {
        fail(`[harness] FAIL - added skills: ${addedBad.join(", ")}`);
      } else if (added.length > 0) {
        console.log(`[harness] ok - added skills: ${added.length} verified`);
      }
    } catch {
      fail("[harness] FAIL - project: .harness/config.json corrupt");
    }
  } else {
    console.log(
      "[harness] info - project not initialized here (run harness init)",
    );
  }
  const mem = readText(path.join(process.cwd(), "MEMORY.md"));
  const ag = readText(path.join(process.cwd(), "AGENTS.md"));
  if (mem !== null || ag !== null) {
    const t = estTokens((mem ?? "") + (ag ?? ""));
    console.log(
      `[harness] info - project context ~${fmtTok(t)} tokens (AGENTS.md + MEMORY.md)`,
    );
  }
  if (mem !== null) {
    const t = estTokens(mem);
    if (t > 4000)
      warn(
        `[harness] warn - MEMORY.md ~${fmtTok(t)} tokens (run harness optimize)`,
      );
    else console.log(`[harness] ok - memory: MEMORY.md ~${fmtTok(t)} tokens`);
  }
  const ol = ollamaState();
  if (ol !== null) {
    const names = ol.models.map((m) => m.name).join(", ");
    console.log(
      `[harness] info - local models: ${ol.runners.length} resident ~${fmtMem(ol.totalKb)}${names ? ` (${names})` : ""}`,
    );
    if (ol.runners.length > 1) {
      warn(
        `[harness] warn - ${ol.runners.length} local models resident (switching residue?) - harness optimize unloads them`,
      );
    }
  }
  const inRepo = (() => {
    try {
      return (
        spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
          stdio: ["ignore", "pipe", "ignore"],
        }).status === 0
      );
    } catch {
      return false;
    }
  })();
  if (!inRepo) {
    console.log(
      "[harness] info - security: not a git repo, staged scan skipped",
    );
  } else {
    const hits = scanStaged();
    if (hits.length > 0) {
      fail(
        `[harness] FAIL - security: possible secrets in staged (${hits.length}): ${hits
          .slice(0, 5)
          .map((h) => `${h.file}:${h.line}`)
          .join(", ")} - unstage and remove them`,
      );
    } else {
      console.log("[harness] ok - security: no secrets in staged");
    }
  }
  console.log = realLog;
  if (json) {
    console.log(
      JSON.stringify(
        { ok, failures: jFails, warnings: jWarns, version: VERSION },
        null,
        2,
      ),
    );
  }
  return ok;
}

// prune a markdown file to a token budget, archiving overflow. no data loss.
export function pruneFile(
  abs: string,
  budget: number,
): { before: number; after: number; moved: number } | null {
  const text = readText(abs);
  if (text === null) return null;
  const before = estTokens(text);
  if (before <= budget) return { before, after: before, moved: 0 };
  const lines = text.split("\n");
  const kept: string[] = [];
  let count = 0;
  for (const l of lines) {
    const t = estTokens(l + "\n");
    if (kept.length >= 10 && count + t > budget) break;
    kept.push(l);
    count += t;
  }
  const rest = lines.slice(kept.length);
  const archive = path.join(
    path.dirname(abs),
    `${path.basename(abs, path.extname(abs))}.archive.md`,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    fs.appendFileSync(archive, `\n## pruned ${stamp}\n\n${rest.join("\n")}\n`);
    fs.writeFileSync(abs, kept.join("\n"));
  } catch {
    return null;
  }
  return { before, after: estTokens(kept.join("\n")), moved: rest.length };
}

// memory prune = prune MEMORY.md + rotate its archive, nothing else.
// optimize layers hook timing, exec repair, ollama unload and the skill
// report on top (both previously ran from `memory prune`).
function cmdMemoryPrune(): boolean {
  const cwd = process.cwd();
  const opts = readOptimizations(cwd);
  const mem = ["MEMORY.md", path.join(".kiro", "MEMORY.md")]
    .map((f) => path.join(cwd, f))
    .find((f) => fs.existsSync(f));
  if (!mem) {
    console.log("[harness] optimize - no MEMORY.md here (run harness init)");
    return true;
  }
  if (opts["prune-memory"] === false) {
    const text = readText(mem);
    console.log(
      `[harness] info - prune-memory off, MEMORY.md ~${fmtTok(estTokens(text ?? ""))} (enable: harness optimizations enable prune-memory)`,
    );
    return true;
  }
  const r = pruneFile(mem, 2000);
  if (!r) {
    console.log("[harness] FAIL - optimize: could not prune MEMORY.md");
    return false;
  }
  if (r.moved === 0) {
    console.log(
      r.before <= 2000
        ? `[harness] ok - memory ~${fmtTok(r.before)} - under 2k budget, nothing to do`
        : `[harness] ok - memory ~${fmtTok(r.before)} - over budget but kept (recent-notes floor; archive manually)`,
    );
  } else {
    console.log(
      `[harness] ok - memory ~${fmtTok(r.before)} -> ~${fmtTok(r.after)}, ${r.moved} lines archived`,
    );
  }
  if (opts["archive-rotate"] !== false) {
    const base = mem.slice(0, -path.extname(mem).length);
    const archive = `${base}.archive.md`;
    const text = readText(archive);
    if (text !== null) {
      const lines = text.split("\n");
      if (lines.length > 500) {
        const trimmed = lines.slice(lines.length - 500);
        try {
          fs.writeFileSync(archive, trimmed.join("\n"));
          console.log(
            `[harness] ok - archive rotated: ${lines.length} -> ${trimmed.length} lines (oldest dropped)`,
          );
        } catch {
          console.log("[harness] warn - could not rotate archive");
        }
      }
    }
  }
  return true;
}

function cmdOptimize(): boolean {
  const root = selfRoot();
  if (!root) {
    console.log("[harness] optimize - cannot locate install");
    return false;
  }
  const cwd = process.cwd();
  if (!cmdMemoryPrune()) return false;
  const opts = readOptimizations(cwd);
  const hooks = listHooks(root);
  let repaired = 0;
  for (const h of hooks) {
    const abs = path.join(root, h);
    if (!isExec(abs)) {
      try {
        fs.chmodSync(abs, 0o755);
        if (isExec(abs)) repaired += 1;
      } catch {
        // keep going
      }
    }
  }
  if (repaired > 0)
    console.log(`[harness] ok - repaired exec on ${repaired} hooks`);
  if (opts["fast-hooks"] !== false) {
    const times: Record<string, number> = {};
    for (const h of hooks) {
      let total = 0;
      for (let i = 0; i < 3; i++)
        total += runHook(path.join(root, h), 10000).ms;
      times[h] = Math.round((total / 3) * 10) / 10;
    }
    const slow = slowHooks(times, 2000);
    if (slow.length > 0) {
      const manFile = path.join(cwd, ".harness", "config.json");
      let man: Record<string, unknown> = {
        version: VERSION,
        harness: [],
        files: [],
      };
      const manText = readText(manFile);
      if (manText !== null) {
        try {
          man = JSON.parse(manText);
        } catch {
          // keep shell below
        }
      }
      const disabled = new Set<string>(
        Array.isArray(man.disabledByPerf)
          ? man.disabledByPerf.filter((x) => typeof x === "string")
          : [],
      );
      let dropped = 0;
      for (const h of slow) {
        try {
          fs.chmodSync(path.join(root, h), 0o644);
          disabled.add(h);
          dropped += 1;
        } catch {
          // keep going
        }
      }
      man.disabledByPerf = [...disabled];
      try {
        fs.mkdirSync(path.dirname(manFile), { recursive: true });
        fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
      } catch {
        console.log("[harness] warn - could not record disabled hooks");
      }
      console.log(
        `[harness] ok - fast-hooks: disabled ${dropped} slow hook(s) over 2s mean: ${slow.join(", ")} (re-enable: harness instinct enable <name>)`,
      );
    }
  }
  const skills = listSkills(root);
  const total = skills.reduce((a, s) => a + s.tokens, 0);
  const top = [...skills].sort((a, b) => b.tokens - a.tokens)[0];
  console.log(
    `[harness] ok - skills ${skills.length} files ~${fmtTok(total)} total${top ? `, largest ${top.name} ~${fmtTok(top.tokens)}` : ""}`,
  );
  reportUnload(unloadOllamaRunners());
  return true;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
      .slice(0, 40) || "note"
  );
}

function cmdMemorySync(note: string): boolean {
  const memFile = path.join(process.cwd(), "MEMORY.md");
  if (readText(memFile) === null) {
    console.log("[harness] memory - no MEMORY.md here (run harness init)");
    return false;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    fs.appendFileSync(memFile, `\n- (${stamp}) ${note}\n`);
  } catch {
    console.log("[harness] FAIL - memory: could not write MEMORY.md");
    return false;
  }
  const opts = readOptimizations(process.cwd());
  if (opts["prune-memory"] === false) {
    const t = estTokens(readText(memFile) ?? "");
    console.log(`[harness] ok - memory synced (~${fmtTok(t)}, pruning off)`);
    return true;
  }
  const r = pruneFile(memFile, 2000);
  if (!r) {
    console.log("[harness] FAIL - memory: could not prune MEMORY.md");
    return false;
  }
  console.log(
    `[harness] ok - memory synced (~${fmtTok(r.after)}${r.moved > 0 ? `, ${r.moved} lines archived` : ""})`,
  );
  return true;
}

function fetchTarball(url: string, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const req = https.get(
        url,
        { headers: { "User-Agent": "agent-harness" } },
        (res) => {
          if (
            res.statusCode !== 200 ||
            !res.headers["content-type"]?.includes("gzip")
          ) {
            res.resume();
            resolve(null);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              req.destroy();
              resolve(null);
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve(Buffer.concat(chunks)));
        },
      );
      req.setTimeout(15000, () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

function tarList(archive: string): string[] {
  const r = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return (r.stdout as string).split("\n").filter(Boolean);
}

function tarRead(archive: string, entry: string): string | null {
  const r = spawnSync("tar", ["-xzOf", archive, entry], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout as string;
}

export function sanitizeSkillName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
}
function fetchText(url: string, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = https.get(
        url,
        { headers: { "User-Agent": "agent-harness" } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            resolve(null);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              req.destroy();
              resolve(null);
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        },
      );
      req.setTimeout(15000, () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

// first SKILL.md in a tarball: root SKILL.md preferred, then skills/*/SKILL.md.
function extractSkillBody(buf: Buffer): string | null {
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "harness-skill-")),
    "pkg.tgz",
  );
  try {
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, buf);
    const entries = tarList(tmp);
    // shallowest SKILL.md wins: root SKILL.md and any skills/<n>/SKILL.md
    // independent of whether the tarball leads with a directory entry.
    const cands = entries
      .filter((e) => /(^|\/)SKILL\.md$/.test(e))
      .sort((a, b) => a.length - b.length);
    return cands.length > 0 ? tarRead(tmp, cands[0]) : null;
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

function finishSkillAdd(body: string, repoLabel: string, ref: string): boolean {
  const cwd = process.cwd();
  const fm = parseFrontmatter(body);
  if (!fm) {
    console.log(
      `[harness] skill add - ${repoLabel} SKILL.md lacks name/description frontmatter`,
    );
    return false;
  }
  const name = sanitizeSkillName(fm.name);
  if (!name) {
    console.log("[harness] skill add - unusable skill name in frontmatter");
    return false;
  }
  const rel = path.join(".harness", "skills", name, "SKILL.md");
  if (fs.existsSync(path.join(cwd, rel))) {
    console.log(`[harness] skill add - ${rel} exists already`);
    return false;
  }
  try {
    fs.mkdirSync(path.join(cwd, ".harness", "skills", name), {
      recursive: true,
    });
    fs.writeFileSync(path.join(cwd, rel), body);
  } catch {
    console.log(`[harness] skill add - could not write ${rel}`);
    return false;
  }
  const manFile = path.join(cwd, ".harness", "config.json");
  let man: Record<string, unknown> = {
    version: VERSION,
    harness: [],
    files: [],
  };
  const manText = readText(manFile);
  if (manText !== null) {
    try {
      man = JSON.parse(manText);
    } catch {
      console.log("[harness] skill add - .harness/config.json corrupt");
      return false;
    }
  }
  const added = (man.addedSkills ?? []) as Array<Record<string, string>>;
  added.push({
    name,
    repo: repoLabel,
    ref,
    sha256: sha256(body),
    ts: new Date().toISOString(),
  });
  man.addedSkills = added;
  try {
    fs.mkdirSync(path.dirname(manFile), { recursive: true });
    fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
  } catch {
    console.log("[harness] skill add - could not update .harness/config.json");
    return false;
  }
  console.log(
    `[harness] ok - skill ${name} from ${ref === "-" ? repoLabel : `${repoLabel}@${ref}`} pinned in manifest`,
  );
  return true;
}

function addFromDir(dir: string): boolean {
  const abs = path.resolve(dir.replace(/^~(?=\/|$)/, os.homedir()));
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(abs);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) {
    console.log(`[harness] skill add - not a directory: ${dir}`);
    return false;
  }
  const cands: string[] = [];
  const direct = path.join(abs, "SKILL.md");
  if (fs.existsSync(direct)) cands.push(direct);
  const skillsDir = path.join(abs, "skills");
  try {
    for (const e of fs.readdirSync(skillsDir).sort()) {
      const f = path.join(skillsDir, e, "SKILL.md");
      if (fs.existsSync(f)) cands.push(f);
    }
  } catch {
    // no skills/ dir is fine
  }
  if (cands.length === 0) {
    console.log(
      `[harness] skill add - no SKILL.md in ${dir} (want SKILL.md at root or skills/<name>/SKILL.md)`,
    );
    return false;
  }
  const body = readText(cands[0]);
  if (body === null) {
    console.log(`[harness] skill add - cannot read ${cands[0]}`);
    return false;
  }
  return finishSkillAdd(body, `local:${abs}`, "-");
}

async function addFromUrl(url: string): Promise<boolean> {
  // codeload URLs carry tar.gz as a path segment (.../tar.gz/<ref>).
  const pathPart = url.split(/[?#]/)[0].toLowerCase();
  const segs = new Set(pathPart.split("/"));
  const isMd = pathPart.endsWith(".md");
  const isTarball =
    !isMd &&
    (segs.has("tar.gz") ||
      segs.has("tgz") ||
      pathPart.endsWith(".tar.gz") ||
      pathPart.endsWith(".tgz"));
  if (!isMd && !isTarball) {
    console.log(
      "[harness] skill add - want a .md file or .tar.gz archive URL (or owner/repo, or --path)",
    );
    return false;
  }
  console.log(`[harness] skill add - fetching ${url}...`);
  if (isMd) {
    const body = await fetchText(url, 256 * 1024);
    if (!body) {
      console.log(`[harness] skill add - could not fetch ${url}`);
      return false;
    }
    return finishSkillAdd(body, url, "-");
  }
  const buf = await fetchTarball(url, 8 * 1024 * 1024);
  if (!buf) {
    console.log(`[harness] skill add - could not fetch ${url}`);
    return false;
  }
  const body = extractSkillBody(buf);
  if (!body) {
    console.log(
      `[harness] skill add - no SKILL.md in ${url} (want SKILL.md at root or skills/<name>/SKILL.md)`,
    );
    return false;
  }
  return finishSkillAdd(body, url, "-");
}

async function cmdSkillAdd(args: string[]): Promise<boolean> {
  if (args[0] === "--path") {
    if (!args[1]) {
      console.log("[harness] skill add - usage: skill add --path <dir>");
      return false;
    }
    return addFromDir(args[1]);
  }
  const spec = (args[0] ?? "").trim();
  if (/^https?:\/\//.test(spec)) {
    return addFromUrl(spec);
  }
  if (
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("~") ||
    fs.existsSync(path.resolve(spec))
  ) {
    return addFromDir(spec);
  }
  const m =
    /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_.\-/]+))?$/.exec(spec);
  if (!m) {
    console.log(
      "[harness] skill add - want owner/repo[@ref], an https URL, or --path <dir>",
    );
    return false;
  }
  const [, repo] = m;
  const givenRef = m[2];
  for (const ref of givenRef ? [givenRef] : ["main", "master"]) {
    const url = `https://codeload.github.com/${repo}/tar.gz/${ref}`;
    console.log(`[harness] skill add - fetching ${repo}@${ref}...`);
    const buf = await fetchTarball(url, 8 * 1024 * 1024);
    if (!buf) continue;
    const body = extractSkillBody(buf);
    if (!body) {
      console.log(
        `[harness] skill add - no SKILL.md in ${repo}@${ref} (want SKILL.md at root or skills/<name>/SKILL.md)`,
      );
      return false;
    }
    return finishSkillAdd(body, repo, ref);
  }
  console.log(
    `[harness] skill add - could not fetch ${repo} (tried main, master)`,
  );
  return false;
}

interface AddedSkill {
  name: string;
  sha256: string;
  repo?: string;
  ref?: string;
}

function readAddedSkills(cwd: string): {
  added: AddedSkill[];
  corrupt: boolean;
} {
  const manText = readText(path.join(cwd, ".harness", "config.json"));
  if (manText === null) return { added: [], corrupt: false };
  try {
    const v = JSON.parse(manText).addedSkills ?? [];
    return { added: Array.isArray(v) ? v : [], corrupt: false };
  } catch {
    return { added: [], corrupt: true };
  }
}

function verifyAddedSkill(cwd: string, a: AddedSkill): string | null {
  const p = path.join(
    cwd,
    ".harness",
    "skills",
    String(a.name ?? ""),
    "SKILL.md",
  );
  const text = readText(p);
  if (text === null) return `${a.name} (missing)`;
  if (sha256(text) !== a.sha256) return `${a.name} (modified)`;
  return null;
}

// re-fetch one added skill from its recorded source (same sources skill
// add accepts: local: dir, http(s) .md/tarball, owner/repo[@ref]).
// validates before overwriting, updates the manifest pin on change.
async function cmdSkillUpdate(name: string): Promise<boolean> {
  const cwd = process.cwd();
  const { added, corrupt } = readAddedSkills(cwd);
  if (corrupt) {
    console.log("[harness] FAIL - .harness/config.json corrupt");
    return false;
  }
  const entry = added.find((a) => a.name === name);
  if (!entry) {
    console.log(`[harness] skill update - no added skill named "${name}"`);
    return false;
  }
  const repo = String(entry.repo ?? "");
  const recordedRef = String(entry.ref ?? "");
  if (!repo) {
    console.log(
      `[harness] skill update - ${name} has no recorded source (added before source pinning)`,
    );
    return false;
  }
  let body: string | null = null;
  if (repo.startsWith("local:")) {
    const abs = repo.slice("local:".length);
    const cands = [path.join(abs, "SKILL.md")];
    try {
      for (const e of fs.readdirSync(path.join(abs, "skills")).sort()) {
        cands.push(path.join(abs, "skills", e, "SKILL.md"));
      }
    } catch {
      // no skills/ dir is fine
    }
    for (const c of cands) {
      body = readText(c);
      if (body !== null) break;
    }
  } else if (/^https?:\/\//.test(repo)) {
    const low = repo.split(/[?#]/)[0].toLowerCase();
    if (low.endsWith(".md")) {
      body = await fetchText(repo, 256 * 1024);
    } else {
      const buf = await fetchTarball(repo, 8 * 1024 * 1024);
      body = buf ? extractSkillBody(buf) : null;
    }
  } else {
    const refs =
      recordedRef && recordedRef !== "-" ? [recordedRef] : ["main", "master"];
    for (const ref of refs) {
      const buf = await fetchTarball(
        `https://codeload.github.com/${repo}/tar.gz/${ref}`,
        8 * 1024 * 1024,
      );
      if (!buf) continue;
      body = extractSkillBody(buf);
      if (body) break;
    }
  }
  if (!body) {
    console.log(
      `[harness] skill update - could not re-fetch ${name} from ${repo}`,
    );
    return false;
  }
  const fm = parseFrontmatter(body);
  if (!fm || sanitizeSkillName(fm.name) !== name) {
    console.log(
      `[harness] skill update - fetched body fails validation (name must stay ${name})`,
    );
    return false;
  }
  const file = path.join(cwd, ".harness", "skills", name, "SKILL.md");
  const cur = readText(file);
  if (cur !== null && sha256(cur) === sha256(body)) {
    console.log(`[harness] ok - skill ${name} already up to date`);
    return true;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  } catch {
    console.log(`[harness] skill update - could not write ${file}`);
    return false;
  }
  const manFile = path.join(cwd, ".harness", "config.json");
  try {
    const manText = readText(manFile);
    if (manText === null) throw new Error("missing");
    const man = JSON.parse(manText);
    man.addedSkills = (man.addedSkills ?? []).map((a: AddedSkill) =>
      a.name === name
        ? { ...a, sha256: sha256(body as string), ts: new Date().toISOString() }
        : a,
    );
    fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
  } catch {
    console.log(
      "[harness] skill update - file written, manifest left stale (re-verify)",
    );
    return false;
  }
  console.log(`[harness] ok - skill ${name} updated`);
  return true;
}

const MAP_EXTS = new Set([".ts", ".js", ".py", ".md", ".json", ".sh"]);
const MAP_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".harness",
  "coverage",
]);

// file rows cap: ~15 tokens each, so 200 files ≈ 3k tokens max.
export const MAP_MAX_FILES = 200;

export function mapSymbols(text: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s && out.length < 12 && !out.includes(s)) out.push(s);
  };
  for (const line of text.split("\n")) {
    let m: RegExpExecArray | null;
    if (
      (m = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(line))
    ) {
      push(m[1] + "()");
    } else if (
      (m =
        /^\s*export\s+(?:const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_]+)/.exec(
          line,
        ))
    ) {
      push(m[1]);
    } else if (/^\s*export\s+default\b/.test(line)) {
      push("default");
    } else if ((m = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)/.exec(line))) {
      push(m[1] + "()");
    } else if ((m = /^class\s+([A-Za-z0-9_]+)/.exec(line))) {
      push(m[1]);
    } else if ((m = /^# (.+)/.exec(line)) && out.length === 0) {
      push(m[1].slice(0, 60));
    }
  }
  return out;
}

export function buildMap(cwd: string): {
  lines: number;
  files: number;
  omitted: number;
  tokens: number;
  text: string;
} {
  const rows: Array<{ rel: string; syms: string[] }> = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      const abs = path.join(dir, e);
      let st: fs.Stats | null = null;
      try {
        // lstat, not stat: a symlink cycle would recurse forever, and a
        // symlinked file would index twice. linked content stays out.
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (MAP_SKIP_DIRS.has(e)) continue;
        walk(abs);
      } else if (MAP_EXTS.has(path.extname(e)) && st.size <= 200000) {
        const text = readText(abs);
        if (text !== null)
          rows.push({ rel: path.relative(cwd, abs), syms: mapSymbols(text) });
      }
    }
  };
  walk(cwd);
  // the index must stay a snack, not a meal: directory layout stays
  // complete, file rows cap at MAP_MAX_FILES with a trailer pointing
  // at grep. without this a monorepo writes a 25k-token MAP.
  const omitted = Math.max(0, rows.length - MAP_MAX_FILES);
  const shown = rows.slice(0, MAP_MAX_FILES);
  const dirs = new Map<string, number>();
  for (const r of rows) {
    const d = path.dirname(r.rel);
    dirs.set(d, (dirs.get(d) ?? 0) + 1);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const out = [
    "# Repo map",
    "",
    `Generated by \`harness map\` on ${stamp}. File -> exported symbols, one line each.`,
    "",
    "## Layout",
    ...[...dirs.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([d, n]) => `- ${d === "." || d === "" ? "." : d}/: ${n} files`),
    "",
    "## Files",
    ...shown.map(
      (r) => `- ${r.rel}${r.syms.length > 0 ? ": " + r.syms.join(", ") : ""}`,
    ),
    ...(omitted > 0
      ? [`- ... +${omitted} more files omitted (grep the repo)`]
      : []),
    "",
  ];
  const text = out.join("\n");
  return {
    lines: out.length,
    files: shown.length,
    omitted,
    tokens: estTokens(text),
    text,
  };
}

function cmdMap(): boolean {
  const cwd = process.cwd();
  const r = buildMap(cwd);
  try {
    fs.mkdirSync(path.join(cwd, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".harness", "MAP.md"), r.text);
  } catch {
    console.log("[harness] FAIL - map: could not write .harness/MAP.md");
    return false;
  }
  console.log(
    `[harness] ok - map: ${r.files} files, ${r.lines} lines, ~${fmtTok(r.tokens)} tokens -> .harness/MAP.md${r.omitted > 0 ? ` (${r.omitted} omitted, capped at ${MAP_MAX_FILES})` : ""}`,
  );
  return true;
}

interface Optimization {
  name: string;
  scope: "ram" | "cpu" | "disk";
  desc: string;
}

const OPTIMIZATIONS: Optimization[] = [
  {
    name: "slim-agents",
    scope: "ram",
    desc: "install slim AGENTS.md (~180 tok) instead of full (~490 tok)",
  },
  {
    name: "prune-memory",
    scope: "ram",
    desc: "keep MEMORY.md within the 2k-token budget",
  },
  {
    name: "map-index",
    scope: "ram",
    desc: "write .harness/MAP.md file index on init",
  },
  {
    name: "fast-hooks",
    scope: "cpu",
    desc: "disable hooks averaging over 2s, measured in optimize",
  },
  {
    name: "archive-rotate",
    scope: "disk",
    desc: "cap MEMORY.archive.md at 500 lines in optimize",
  },
];

function defaultOptimizations(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const o of OPTIMIZATIONS) out[o.name] = true;
  return out;
}

// manifest toggles merged over defaults (unknown names ignored).
function readOptimizations(cwd: string): Record<string, boolean> {
  const out = defaultOptimizations();
  try {
    const text = readText(path.join(cwd, ".harness", "config.json"));
    if (text === null) return out;
    const saved = JSON.parse(text).optimizations ?? {};
    for (const o of OPTIMIZATIONS) {
      if (typeof saved[o.name] === "boolean") out[o.name] = saved[o.name];
    }
  } catch {
    // corrupt manifest: defaults stand
  }
  return out;
}

function writeOptimizations(
  cwd: string,
  patch: Record<string, boolean>,
): boolean {
  const manFile = path.join(cwd, ".harness", "config.json");
  let man: Record<string, unknown> = {
    version: VERSION,
    harness: [],
    files: [],
  };
  const manText = readText(manFile);
  if (manText !== null) {
    try {
      man = JSON.parse(manText);
    } catch {
      console.log("[harness] FAIL - .harness/config.json corrupt");
      return false;
    }
  }
  const merged = {
    ...defaultOptimizations(),
    ...((man.optimizations ?? {}) as Record<string, boolean>),
    ...patch,
  };
  const clean: Record<string, boolean> = {};
  for (const o of OPTIMIZATIONS) clean[o.name] = merged[o.name] !== false;
  man.optimizations = clean;
  try {
    fs.mkdirSync(path.dirname(manFile), { recursive: true });
    fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
  } catch {
    console.log("[harness] FAIL - could not write .harness/config.json");
    return false;
  }
  return true;
}

function readDisabledByPerf(cwd: string): Set<string> {
  try {
    const text = readText(path.join(cwd, ".harness", "config.json"));
    if (text === null) return new Set();
    const list = JSON.parse(text).disabledByPerf ?? [];
    return new Set(
      Array.isArray(list) ? list.filter((x) => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

// pure: which hooks exceed budget. unit-tested.
export function slowHooks(
  measurements: Record<string, number>,
  budgetMs: number,
): string[] {
  return Object.entries(measurements)
    .filter(([, ms]) => ms > budgetMs)
    .map(([name]) => name)
    .sort();
}

function cmdOptimizations(args: string[]): boolean {
  const cwd = process.cwd();
  const sub = args[0] ?? "";
  if (sub === "" || sub === "list") {
    const opts = readOptimizations(cwd);
    console.log("[harness] optimizations (all on by default):");
    for (const o of OPTIMIZATIONS) {
      console.log(
        `  ${o.name} [${o.scope}] ${opts[o.name] ? "on" : "off"} - ${o.desc}`,
      );
    }
    return true;
  }
  if (sub !== "enable" && sub !== "disable") {
    console.log("[harness] optimizations - want [enable|disable] <name|all>");
    return false;
  }
  const target = args[1] ?? "";
  const names =
    target === "all"
      ? OPTIMIZATIONS.map((o) => o.name)
      : OPTIMIZATIONS.map((o) => o.name).filter((n) => n === target);
  if (names.length === 0) {
    console.log(
      `[harness] optimizations - unknown name "${target}" (try: ${OPTIMIZATIONS.map((o) => o.name).join(", ")})`,
    );
    return false;
  }
  const patch: Record<string, boolean> = {};
  for (const n of names) patch[n] = sub === "enable";
  if (!writeOptimizations(cwd, patch)) return false;
  console.log(`[harness] ok - optimizations ${sub}d: ${names.join(", ")}`);
  return true;
}

async function runCommand(cmd: string, flags: string[]): Promise<boolean> {
  const all = [cmd, ...flags];

  if (
    all.includes("-h") ||
    all.includes("--help") ||
    cmd === "help" ||
    cmd === "-h" ||
    cmd === "--help"
  ) {
    help();
    return true;
  }
  if (
    all.includes("-v") ||
    all.includes("--version") ||
    cmd === "version" ||
    cmd === "-v" ||
    cmd === "--version"
  ) {
    console.log(`harness ${VERSION}`);
    return true;
  }

  switch (cmd as Command) {
    case "init": {
      return cmdInit(flags);
    }
    case "doctor": {
      return cmdDoctor(flags);
    }
    case "status": {
      return cmdStatus();
    }
    case "bench": {
      return cmdBench(flags);
    }
    case "map": {
      return cmdMap();
    }
    case "optimize": {
      return cmdOptimize();
    }
    case "optimizations": {
      return cmdOptimizations(flags);
    }
    case "adapter": {
      if (flags[0] === "add" || flags[0] === "remove") {
        const raw = flags[1] ?? "";
        if (!/^[a-z0-9-]+$/.test(raw)) {
          console.log(
            `[harness] adapter ${flags[0]} - want a lowercase-hyphen name`,
          );
          return false;
        }
        const dir = path.join(process.cwd(), ".harness", "adapters", raw);
        if (flags[0] === "remove") {
          if (
            !fs.existsSync(dir) ||
            !fs.existsSync(path.join(dir, "adapter.json"))
          ) {
            console.log(
              `[harness] adapter remove - no custom adapter named "${raw}"`,
            );
            return false;
          }
          try {
            fs.rmSync(dir, { recursive: true });
          } catch {
            console.log(`[harness] adapter remove - could not remove ${dir}`);
            return false;
          }
          console.log(`[harness] ok - adapter ${raw} removed`);
          return true;
        }
        if (fs.existsSync(dir)) {
          console.log(`[harness] adapter add - ${dir} exists already`);
          return false;
        }
        const adapterJson =
          JSON.stringify(
            {
              name: raw,
              displayName: raw,
              skillPath: "",
              hookPath: "",
              memoryPath: "MEMORY.md",
              agentsPath: "AGENTS.md",
              transpile: "./transpile.sh",
              notes: `Fill in skillPath, then run: harness init --harness ${raw}`,
            },
            null,
            2,
          ) + "\n";
        const wrapper = `#!/usr/bin/env bash\n# install this adapter's files into the current project.\n# delegates to harness init so there is one real implementation.\nset -euo pipefail\nif ! command -v harness >/dev/null 2>&1; then\n  echo "[${raw}] harness not found - install it first" >&2\n  exit 1\nfi\nexec harness init --harness ${raw} --migrate\n`;
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "adapter.json"), adapterJson);
          fs.writeFileSync(path.join(dir, "transpile.sh"), wrapper);
          fs.chmodSync(path.join(dir, "transpile.sh"), 0o755);
        } catch {
          console.log(`[harness] adapter add - could not scaffold ${raw}`);
          return false;
        }
        console.log(
          `[harness] ok - adapter ${raw} scaffolded (fill in skillPath, then: harness init --harness ${raw})`,
        );
        return true;
      }
      if (flags[0] === "list" || flags.length === 0) {
        const root = selfRoot();
        if (!root) {
          console.log("[harness] adapter - cannot locate install");
          return false;
        }
        const packaged = listAdapters(root);
        const packagedNames = new Set(packaged.map((a) => a.name));
        for (const a of packaged) {
          console.log(
            `  ${a.name}${a.json?.displayName ? ` - ${a.json.displayName}` : ""}${a.error ? ` (${a.error})` : ""}`,
          );
        }
        for (const a of listAdapters(
          process.cwd(),
          path.join(".harness", "adapters"),
        )) {
          if (packagedNames.has(a.name)) {
            console.log(`  ${a.name} (custom override)`);
            continue;
          }
          console.log(`  ${a.name} (custom)${a.error ? ` (${a.error})` : ""}`);
        }
        return true;
      }
      console.log(`[harness] adapter ${flags.join(" ")} - not implemented yet`);
      return true;
    }
    case "skill": {
      if (flags[0] === "add") {
        return cmdSkillAdd(flags.slice(1));
      }
      if (flags[0] === "remove") {
        const name = sanitizeSkillName(flags[1] ?? "");
        if (!name) {
          console.log("[harness] skill remove - give an added skill name");
          return false;
        }
        const dir = path.join(process.cwd(), ".harness", "skills", name);
        if (!fs.existsSync(dir)) {
          console.log(
            `[harness] skill remove - no added skill named "${flags[1]}" (built-ins live in the install, not here)`,
          );
          return false;
        }
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          console.log(`[harness] skill remove - could not remove ${name}`);
          return false;
        }
        const manFile = path.join(process.cwd(), ".harness", "config.json");
        const manText = readText(manFile);
        if (manText !== null) {
          try {
            const man = JSON.parse(manText);
            man.addedSkills = (man.addedSkills ?? []).filter(
              (a: AddedSkill) => a.name !== name,
            );
            fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
          } catch {
            console.log(
              "[harness] skill remove - manifest left stale, edit it by hand",
            );
            return false;
          }
        }
        console.log(`[harness] ok - skill ${name} removed`);
        return true;
      }
      if (flags[0] === "verify") {
        const { added, corrupt } = readAddedSkills(process.cwd());
        if (corrupt) {
          console.log("[harness] FAIL - .harness/config.json corrupt");
          return false;
        }
        const list = flags[1]
          ? added.filter((a) => a.name === flags[1])
          : added;
        if (flags[1] && list.length === 0) {
          console.log(
            `[harness] skill verify - no added skill named "${flags[1]}"`,
          );
          return false;
        }
        if (list.length === 0) {
          console.log(
            "[harness] skill verify - no added skills (add one with: harness skill add owner/repo)",
          );
          return true;
        }
        const bad = list
          .map((a) => verifyAddedSkill(process.cwd(), a))
          .filter((x): x is string => Boolean(x));
        if (bad.length > 0) {
          console.log(`[harness] FAIL - skills: ${bad.join(", ")}`);
          return false;
        }
        console.log(`[harness] ok - ${list.length} added skill(s) verified`);
        return true;
      }
      const root = selfRoot();
      if (!root) {
        console.log("[harness] skill - cannot locate install");
        return false;
      }
      const skills = listSkills(root);
      if (flags.length === 0 || flags[0] === "list") {
        for (const s of skills) {
          console.log(
            `  ${s.name} - ${s.desc || "(no description)"} (~${fmtTok(s.tokens)})`,
          );
        }
        return true;
      }
      if (flags[0] === "search") {
        const q = flags.slice(1).join(" ").toLowerCase().trim();
        if (!q) {
          console.log("[harness] skill search - give a query");
          return false;
        }
        const hits = skills.filter((s) => {
          const body = (readText(s.file) ?? "").toLowerCase();
          return (
            s.name.includes(q) ||
            s.desc.toLowerCase().includes(q) ||
            body.includes(q)
          );
        });
        if (hits.length === 0) {
          console.log(`[harness] skill search - no skills match "${q}"`);
        }
        for (const s of hits) {
          console.log(`  ${s.name} - ${s.desc || "(no description)"}`);
        }
        return true;
      }
      if (flags[0] === "lint") {
        const only = flags[1] ?? "";
        const list = only ? skills.filter((s) => s.name === only) : skills;
        if (only && list.length === 0) {
          console.log(
            `[harness] skill lint - unknown skill "${only}" (try: harness skill list)`,
          );
          return false;
        }
        let bad = 0;
        for (const s of list) {
          const fm = parseFrontmatter(readText(s.file) ?? "");
          const problems: string[] = [];
          if (!fm) problems.push("frontmatter missing name/description");
          else if (!fm.desc) problems.push("description missing");
          if (problems.length > 0) {
            console.log(`  ${s.name} FAIL - ${problems.join("; ")}`);
            bad += 1;
          } else {
            console.log(`  ${s.name} ok`);
          }
        }
        return bad === 0;
      }
      if (flags[0] === "update") {
        const name = sanitizeSkillName(flags[1] ?? "");
        if (!name) {
          console.log("[harness] skill update - give an added skill name");
          return false;
        }
        return cmdSkillUpdate(name);
      }
      if (flags[0] === "info") {
        const s = skills.find((x) => x.name === flags[1]);
        if (!s) {
          console.log(
            "[harness] skill info - unknown skill (try: harness skill list)",
          );
          return false;
        }
        const body = readText(s.file);
        if (body === null) {
          console.log(`[harness] skill info - cannot read ${s.name}`);
          return false;
        }
        console.log(body);
        return true;
      }
      console.log(`[harness] skill ${flags.join(" ")} - not implemented yet`);
      return true;
    }
    case "memory": {
      if (flags[0] === "show") {
        const text = readText(path.join(process.cwd(), "MEMORY.md"));
        if (text === null) {
          console.log(
            "[harness] memory - no MEMORY.md here (run harness init)",
          );
        } else {
          console.log(text);
        }
        return true;
      }
      if (flags[0] === "prune") {
        return cmdMemoryPrune();
      }
      if (flags[0] === "sync") {
        const note = flags.slice(1).join(" ").trim();
        if (!note) {
          console.log("[harness] memory sync - give a note to append");
          return false;
        }
        return cmdMemorySync(note);
      }
      if (flags[0] === "stats") {
        const memFile = path.join(process.cwd(), "MEMORY.md");
        const text = readText(memFile);
        if (text === null) {
          console.log(
            "[harness] memory - no MEMORY.md here (run harness init)",
          );
          return false;
        }
        const lines = text.split("\n");
        const sections = lines.filter((l) => l.startsWith("#")).length;
        console.log(
          `  MEMORY.md ~${fmtTok(estTokens(text))} tokens, ${lines.length} lines, ${sections} sections`,
        );
        const archFile = path.join(process.cwd(), "MEMORY.archive.md");
        const arch = readText(archFile);
        if (arch !== null) {
          console.log(
            `  MEMORY.archive.md ~${fmtTok(estTokens(arch))} tokens, ${arch.split("\n").length} lines`,
          );
        }
        return true;
      }
      if (flags[0] === "search") {
        const term = flags.slice(1).join(" ").trim().toLowerCase();
        if (!term) {
          console.log("[harness] memory search - give a term to find");
          return false;
        }
        const files = ["MEMORY.md", "MEMORY.archive.md"];
        let hits = 0;
        for (const f of files) {
          const text = readText(path.join(process.cwd(), f));
          if (text === null) continue;
          text.split("\n").forEach((l, i) => {
            if (hits < 20 && l.toLowerCase().includes(term)) {
              console.log(`  ${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
              hits += 1;
            }
          });
        }
        if (hits === 0) {
          console.log(
            `[harness] memory - no hits for "${flags.slice(1).join(" ").trim()}"`,
          );
        }
        return true;
      }
      if (flags[0] === "backup") {
        const memFile = path.join(process.cwd(), "MEMORY.md");
        const text = readText(memFile);
        if (text === null) {
          console.log(
            "[harness] memory - no MEMORY.md here (run harness init)",
          );
          return false;
        }
        const stamp = new Date().toISOString().slice(0, 10);
        let dest = path.join(process.cwd(), `MEMORY.backup.${stamp}.md`);
        for (let n = 2; fs.existsSync(dest); n++) {
          dest = path.join(process.cwd(), `MEMORY.backup.${stamp}-${n}.md`);
        }
        try {
          fs.writeFileSync(dest, text);
        } catch {
          console.log("[harness] FAIL - memory: could not write backup");
          return false;
        }
        console.log(
          `[harness] ok - memory backed up to ${path.basename(dest)}`,
        );
        return true;
      }
      if (flags[0] === "edit") {
        const memFile = path.join(process.cwd(), "MEMORY.md");
        if (!fs.existsSync(memFile)) {
          console.log(
            "[harness] memory - no MEMORY.md here (run harness init)",
          );
          return false;
        }
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          console.log(
            `[harness] memory - no terminal, edit ${memFile} by hand`,
          );
          return false;
        }
        const editor = (process.env.EDITOR || process.env.VISUAL || "vi").split(
          " ",
        )[0];
        const r = spawnSync(editor, [memFile], { stdio: "inherit" });
        return r.status === 0;
      }
      console.log(`[harness] memory ${flags.join(" ")} - not implemented yet`);
      return true;
    }
    case "instinct": {
      const root = selfRoot();
      if (!root) {
        console.log("[harness] instinct - cannot locate install");
        return false;
      }
      if (flags[0] === "list" || flags.length === 0) {
        for (const h of listHooks(root)) {
          console.log(
            `  ${h} ${isExec(path.join(root, h)) ? "exec" : "noexec"}`,
          );
        }
        return true;
      }
      if (flags[0] === "test") {
        const name = flags[1] ?? "";
        if (!name) {
          console.log("[harness] instinct test - give a hook name");
          return false;
        }
        const matched = listHooks(root).filter((h) => h.includes(name));
        if (matched.length === 0) {
          console.log(`[harness] instinct - no hooks match "${name}"`);
          return false;
        }
        let bad = 0;
        for (const h of matched) {
          const r = runHook(path.join(root, h), 10000);
          console.log(
            `  ${h} ${r.ms.toFixed(0)}ms exit ${r.status === null ? "timeout" : r.status} ${r.status === 0 ? "ok" : "FAIL"}`,
          );
          if (r.status !== 0) bad += 1;
        }
        return bad === 0;
      }
      if (flags[0] === "enable" || flags[0] === "disable") {
        const name = flags[1] ?? "";
        if (!name) {
          console.log(`[harness] instinct ${flags[0]} - give a hook name`);
          return false;
        }
        const matched = listHooks(root).filter((h) => h.includes(name));
        if (matched.length === 0) {
          console.log(`[harness] instinct - no hooks match "${name}"`);
          return false;
        }
        // record intent in the manifest, or the next `doctor --fix` would
        // silently chmod the hooks back on (same list optimize maintains).
        const manFile = path.join(process.cwd(), ".harness", "config.json");
        let man: Record<string, unknown> = {
          version: VERSION,
          harness: [],
          files: [],
        };
        const manText = readText(manFile);
        if (manText !== null) {
          try {
            man = JSON.parse(manText);
          } catch {
            console.log(
              "[harness] FAIL - .harness/config.json corrupt (fix it first)",
            );
            return false;
          }
        }
        const disabled = new Set<string>(
          Array.isArray(man.disabledByPerf)
            ? man.disabledByPerf.filter((x) => typeof x === "string")
            : [],
        );
        let done = 0;
        for (const h of matched) {
          try {
            fs.chmodSync(
              path.join(root, h),
              flags[0] === "enable" ? 0o755 : 0o644,
            );
            if (flags[0] === "disable") disabled.add(h);
            else disabled.delete(h);
            done += 1;
          } catch {
            // keep going
          }
        }
        man.disabledByPerf = [...disabled];
        try {
          fs.mkdirSync(path.dirname(manFile), { recursive: true });
          fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
        } catch {
          console.log("[harness] warn - could not record disabled hooks");
        }
        console.log(
          `[harness] ok - instinct ${flags[0]}d ${done}/${matched.length}`,
        );
        return done === matched.length;
      }
      console.log(
        `[harness] instinct ${flags.join(" ")} - not implemented yet`,
      );
      return true;
    }
    case "research": {
      if (flags[0] === "search") {
        const term = flags.slice(1).join(" ").trim().toLowerCase();
        if (!term) {
          console.log("[harness] research search - give a term to find");
          return false;
        }
        let files: string[] = [];
        try {
          files = fs
            .readdirSync(path.join(process.cwd(), "research", "findings"))
            .filter((f) => f.endsWith(".md"))
            .sort();
        } catch {
          files = [];
        }
        let hits = 0;
        for (const f of files) {
          const text = readText(
            path.join(process.cwd(), "research", "findings", f),
          );
          if (text === null) continue;
          const line = text
            .split("\n")
            .find((l) => l.toLowerCase().includes(term));
          if (line !== undefined && hits < 20) {
            console.log(
              `  ${f} - ${line.trim().replace(/^# /, "").slice(0, 120)}`,
            );
            hits += 1;
          }
        }
        if (hits === 0) {
          console.log(
            `[harness] research - no findings mention "${flags.slice(1).join(" ").trim()}"`,
          );
        }
        return true;
      }
      if (flags[0] === "remove") {
        const name = flags.slice(1).join(" ").trim();
        if (!name) {
          console.log("[harness] research remove - give a finding name");
          return false;
        }
        // slugify + basename: the resolved path can never leave findings/.
        const file = `${slugify(name)}.md`;
        const abs = path.join(process.cwd(), "research", "findings", file);
        if (!fs.existsSync(abs)) {
          console.log(`[harness] research remove - no finding named "${name}"`);
          return false;
        }
        try {
          fs.rmSync(abs);
        } catch {
          console.log(`[harness] research remove - could not remove ${file}`);
          return false;
        }
        console.log(`[harness] ok - research ${file} removed`);
        return true;
      }
      if (flags.length === 0) {
        let files: string[] = [];
        try {
          files = fs
            .readdirSync(path.join(process.cwd(), "research", "findings"))
            .filter((f) => f.endsWith(".md"))
            .sort();
        } catch {
          files = [];
        }
        if (files.length === 0) {
          console.log(
            '[harness] research - no findings yet (capture one: harness research "query")',
          );
          return true;
        }
        for (const f of files) {
          const text = readText(
            path.join(process.cwd(), "research", "findings", f),
          );
          const title = text?.split("\n").find((l) => l.startsWith("# ")) ?? f;
          console.log(`  ${f} - ${title.replace(/^# /, "")}`);
        }
        return true;
      }
      const query = flags.join(" ").trim();
      if (!query) {
        console.log("[harness] research - give a query to capture");
        return false;
      }
      const rel = path.join("research", "findings", `${slugify(query)}.md`);
      const abs = path.join(process.cwd(), rel);
      if (fs.existsSync(abs)) {
        console.log(`[harness] research - ${rel} exists already`);
        return true;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(
          abs,
          `# Findings: ${query}\n\nDate: ${stamp}\nStatus: draft\nSources:\n\n- \n\n## Verdict\n\n\n`,
        );
      } catch {
        console.log("[harness] FAIL - research: could not write finding");
        return false;
      }
      console.log(
        `[harness] ok - research stub: ${rel} (fill it in, then plan)`,
      );
      return true;
    }
    case "security": {
      const root = selfRoot();
      if (!root) {
        console.log("[harness] security - cannot locate install");
        return false;
      }
      // a --flag in first position is not the subcommand: without this,
      // `security --staged` reads "--staged" as the subcommand and fails.
      const sub = flags[0] && !flags[0].startsWith("--") ? flags[0] : "audit";
      if (sub !== "audit" && sub !== "scan") {
        console.log(
          `[harness] security ${flags.join(" ")} - not implemented yet`,
        );
        return true;
      }
      const abs = path.join(root, "security", "audit.sh");
      if (!fs.existsSync(abs)) {
        console.log("[harness] security - audit.sh missing from install");
        return false;
      }
      const rest = sub === flags[0] ? flags.slice(1) : flags;
      const args =
        sub === "scan" && !rest.includes("--staged")
          ? ["--staged", ...rest]
          : rest;
      const r = spawnSync("bash", [abs, ...args], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      return r.status === 0;
    }
    case "upgrade":
      if (flags.includes("--check")) return cmdUpgradeCheck();
      return selfUpgrade();
    case "gui":
      return cmdGui(flags);
    default:
      console.error(`[harness] unknown command: ${cmd}`);
      return false;
  }
}

// ---------- web gui (harness gui) ----------

function loadGuiPage(): string | null {
  const root = selfRoot();
  if (!root) return null;
  return readText(path.join(root, "templates", "gui", "index.html"));
}

function readBody(
  req: http.IncomingMessage,
  max = 1024 * 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error("too large"));
        req.destroy();
      } else {
        body += c.toString("utf8");
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function captureRun(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  const lines: string[] = [];
  const realLog = console.log;
  const realErr = console.error;
  console.log = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  console.error = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  try {
    const ok = await runCommand(cmd, args);
    const output = lines.join("\n").trim();
    return { ok, output: output || "(no output)" };
  } finally {
    console.log = realLog;
    console.error = realErr;
  }
}

// one run at a time: captureRun installs global loggers, so overlapping
// requests would cross-contaminate each other's output.
let runBusy = false;

export function captureRunSingleton(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  if (runBusy)
    return Promise.resolve({
      ok: false,
      output: "[harness] a run is already active - wait for it to finish",
    });
  runBusy = true;
  return captureRun(cmd, args).finally(() => {
    runBusy = false;
  });
}

async function runAgent(
  agent: string,
  prompt: string,
): Promise<{ ok: boolean; output: string; ms: number }> {
  const t0 = Date.now();
  const bin =
    agent === "opencode" ? "opencode" : agent === "claude" ? "claude" : "";
  if (!bin) return { ok: false, output: `unknown agent: ${agent}`, ms: 0 };
  if (!haveBin(bin)) {
    return { ok: false, output: `${bin} not found - install it first`, ms: 0 };
  }
  const clean = prompt.trim().slice(0, 8000);
  if (!clean) return { ok: false, output: "give a prompt to run", ms: 0 };
  // argv arrays only, never a shell; cwd is the project the server runs in.
  const argv = bin === "opencode" ? ["run", clean] : ["-p", clean];
  return new Promise((resolve) => {
    const cap = 1024 * 1024;
    let out = "";
    const push = (d: Buffer) => {
      if (out.length < cap)
        out += d.toString("utf8").slice(0, cap - out.length);
    };
    let settled = false;
    const done = (ok: boolean, extra = "") => {
      if (settled) return;
      settled = true;
      const text = (out.trim() + extra).slice(0, cap) || "(no output)";
      resolve({ ok, output: text, ms: Date.now() - t0 });
    };
    const child = spawn(bin, argv, { cwd: process.cwd(), timeout: 600000 });
    child.stdout?.on("data", push);
    child.stderr?.on("data", push);
    child.on("error", () => done(false, "\n[harness] could not start " + bin));
    child.on("close", (code) => done(code === 0));
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      done(false, "\n[harness] timed out after 10 minutes");
    }, 600000);
    if (typeof timer.unref === "function") timer.unref();
  });
}

async function handleGui(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  page: string | null,
): Promise<void> {
  const send = (code: number, body: string, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type });
    res.end(body);
  };
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      if (page === null) return send(500, "gui page missing");
      return send(200, page, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      return send(
        200,
        JSON.stringify({
          version: VERSION,
          cwd: process.cwd(),
          agents: { opencode: haveBin("opencode"), claude: haveBin("claude") },
          project: guiProjectStats(),
        }),
      );
    }
    if (req.method === "GET" && url.pathname === "/api/update-info") {
      return send(200, JSON.stringify(await guiUpdateInfo()));
    }
    if (url.pathname === "/api/term/start" && req.method === "POST") {
      let mode = "menu";
      try {
        const parsed = JSON.parse(await readBody(req)) as { mode?: unknown };
        if (parsed.mode === "shell") mode = "shell";
      } catch {
        // empty body means menu
      }
      return send(200, JSON.stringify(termStart(mode)));
    }
    if (url.pathname === "/api/term/input" && req.method === "POST") {
      const parsed = JSON.parse(await readBody(req)) as {
        id?: unknown;
        data?: unknown;
      };
      if (typeof parsed.id !== "string" || typeof parsed.data !== "string") {
        return send(
          400,
          JSON.stringify({ ok: false, output: "want {id, data}" }),
        );
      }
      return send(200, JSON.stringify(termInput(parsed.id, parsed.data)));
    }
    if (url.pathname === "/api/term/poll" && req.method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      return send(200, JSON.stringify(termPoll(id)));
    }
    if (url.pathname === "/api/term/kill" && req.method === "POST") {
      const parsed = JSON.parse(await readBody(req)) as { id?: unknown };
      if (typeof parsed.id !== "string") {
        return send(400, JSON.stringify({ ok: false, output: "want {id}" }));
      }
      return send(200, JSON.stringify(termKill(parsed.id)));
    }
    if (req.method === "POST" && url.pathname === "/api/run") {
      const parsed = JSON.parse(await readBody(req)) as {
        cmd?: unknown;
        args?: unknown;
      };
      if (typeof parsed.cmd !== "string" || !parsed.cmd) {
        return send(
          400,
          JSON.stringify({ ok: false, output: "want {cmd, args}" }),
        );
      }
      const argv = Array.isArray(parsed.args)
        ? parsed.args
            .filter((a): a is string => typeof a === "string")
            .slice(0, 20)
        : [];
      if (
        parsed.cmd === "upgrade" &&
        !(argv.length === 1 && argv[0] === "--check")
      ) {
        return send(
          200,
          JSON.stringify({
            ok: false,
            output:
              "[harness] upgrade runs only in the terminal (it reinstalls this binary); upgrade --check works here",
          }),
        );
      }
      const r = await Promise.race([
        captureRunSingleton(parsed.cmd, argv),
        new Promise<{ ok: boolean; output: string }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: false,
                output: "[harness] timed out after 10 minutes",
              }),
            600000,
          ),
        ),
      ]);
      return send(200, JSON.stringify(r));
    }
    if (req.method === "POST" && url.pathname === "/api/agent") {
      const parsed = JSON.parse(await readBody(req)) as {
        agent?: unknown;
        prompt?: unknown;
      };
      if (parsed.agent !== "opencode" && parsed.agent !== "claude") {
        return send(
          400,
          JSON.stringify({ ok: false, output: "want agent opencode|claude" }),
        );
      }
      if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) {
        return send(
          400,
          JSON.stringify({ ok: false, output: "want a prompt" }),
        );
      }
      return send(
        200,
        JSON.stringify(await runAgent(parsed.agent, parsed.prompt)),
      );
    }
    if (req.method === "POST" && url.pathname === "/api/quit") {
      send(200, JSON.stringify({ ok: true }));
      termKillAll();
      setTimeout(() => process.exit(0), 100);
      return;
    }
    return send(404, JSON.stringify({ ok: false, output: "not found" }));
  } catch (e) {
    try {
      send(
        500,
        JSON.stringify({
          ok: false,
          output: String((e as Error)?.message ?? e),
        }),
      );
    } catch {
      // response already gone
    }
  }
}

type TermSession = {
  proc: import("node:child_process").ChildProcess;
  buf: string;
  exited: boolean;
};
const termSessions = new Map<string, TermSession>();
const TERM_MAX_SESSIONS = 3;
const TERM_BUF_CAP = 1024 * 1024;

function termSpawn(mode: string): TermSession {
  // Real PTY via the stdlib-only python bridge (node has no built-in pty,
  // and node-pty would need a native build). argv[1] is unreliable (vitest
  // workers, bin symlinks), so both paths resolve through the package root.
  const root = selfRoot();
  const entry = root ? path.join(root, "dist", "harness", "cli.js") : "";
  const bridge = root ? path.join(root, "src", "harness", "gui-pty.py") : "";
  const missing = (msg: string): TermSession => ({
    proc: undefined as unknown as import("node:child_process").ChildProcess,
    buf: msg,
    exited: true,
  });
  if (!entry || !fs.existsSync(entry)) {
    return missing(
      "[harness] terminal unavailable - built CLI not found (run npm run build)\n",
    );
  }
  if (!bridge || !fs.existsSync(bridge)) {
    return missing("[harness] terminal unavailable - pty bridge missing\n");
  }
  const shell = mode === "shell";
  const cmd = shell ? ["bash", "-l"] : ["node", entry];
  const proc = spawn("python3", [bridge, "80", "24", ...cmd], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(shell ? {} : { HARNESS_INTERACTIVE: "1" }),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stdin?.on("error", () => {
    // child already gone; termInput guards with destroyed/exited flags
  });
  const s: TermSession = { proc, buf: "", exited: false };
  const feed = (chunk: Buffer) => {
    s.buf += chunk.toString("utf8");
    if (s.buf.length > TERM_BUF_CAP) s.buf = s.buf.slice(-TERM_BUF_CAP);
  };
  proc.stdout?.on("data", feed);
  proc.stderr?.on("data", feed);
  proc.on("exit", () => {
    s.exited = true;
  });
  proc.on("error", (e) => {
    s.buf += `\n[harness] terminal failed to start: ${String((e as Error)?.message ?? e)}\n`;
    s.exited = true;
  });
  return s;
}

function termStart(mode: string): { ok: boolean; id: string } {
  while (termSessions.size >= TERM_MAX_SESSIONS) {
    const oldest = termSessions.keys().next().value;
    if (oldest === undefined) break;
    termKill(oldest);
  }
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`;
  termSessions.set(id, termSpawn(mode));
  return { ok: true, id };
}

function termInput(id: string, data: string): { ok: boolean } {
  const s = termSessions.get(id);
  if (!s || s.exited || !s.proc.stdin || s.proc.stdin.destroyed)
    return { ok: false };
  s.proc.stdin.write(data.slice(0, 64 * 1024));
  return { ok: true };
}

function termPoll(id: string): {
  ok: boolean;
  output: string;
  exited: boolean;
} {
  const s = termSessions.get(id);
  if (!s) return { ok: false, output: "", exited: true };
  const out = s.buf.slice(0, 256 * 1024);
  s.buf = s.buf.slice(out.length);
  if (s.exited && !s.buf.length) {
    try {
      s.proc?.stdin?.destroy();
    } catch {
      // already gone
    }
    termSessions.delete(id);
  }
  return { ok: true, output: out, exited: s.exited };
}

function termKill(id: string): { ok: boolean } {
  const s = termSessions.get(id);
  if (!s) return { ok: false };
  termSessions.delete(id);
  try {
    s.proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        s.proc.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 2000).unref?.();
  } catch {
    // already gone
  }
  return { ok: true };
}

function termKillAll(): void {
  for (const id of [...termSessions.keys()]) termKill(id);
}

export function startGuiServer(
  port: number,
): Promise<{ server: http.Server; port: number }> {
  const page = loadGuiPage();
  const server = http.createServer((req, res) => {
    void handleGui(req, res, page);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        port: typeof addr === "object" && addr ? addr.port : port,
      });
    });
  });
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") return;
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // printed URL suffices
  }
}

async function cmdGui(flags: string[]): Promise<boolean> {
  let want = 5000;
  const pi = flags.indexOf("--port");
  if (pi !== -1 && !flags[pi + 1]) {
    console.log("[harness] gui - --port needs a number (harness gui --port 5000)");
    return false;
  }
  if (pi !== -1) {
    const n = parseInt(flags[pi + 1] ?? "", 10);
    if (Number.isFinite(n) && n > 0 && n < 65536) want = n;
  }
  if (loadGuiPage() === null) {
    console.log("[harness] gui - cannot locate install");
    return false;
  }
  guiMode = true;
  let started: { server: http.Server; port: number } | null = null;
  for (let p = want; p < want + 10; p++) {
    try {
      started = await startGuiServer(p);
      break;
    } catch {
      // busy, try next
    }
  }
  if (!started) {
    console.log(`[harness] gui - no free port near ${want}`);
    return false;
  }
  const url = `http://127.0.0.1:${started.port}/`;
  console.log(
    `[harness] gui - serving ${process.cwd()} at ${url} (Ctrl-C to stop)`,
  );
  openBrowser(url);
  await new Promise(() => {});
  return true;
}

async function main() {
  if (process.argv.length <= 2) {
    // HARNESS_INTERACTIVE=1 forces the menu loop with piped stdio (used by
    // the gui terminal tab); without a TTY the pickers fall back to numbered
    // line mode on their own.
    if (process.stdin.isTTY || process.env.HARNESS_INTERACTIVE === "1") {
      await interactive();
      return;
    }
    help();
    return;
  }
  const { cmd, flags } = parseArgs(process.argv);
  const ok = await runCommand(cmd, flags);
  if (!ok) {
    help();
    process.exit(1);
  }
}

// only auto-run as a CLI, never on import (vitest imports this module).
// argv[1] can be a bin symlink, so compare realpaths, not strings.
const invokedAsCli = (() => {
  try {
    const a1 = process.argv[1];
    if (typeof a1 !== "string" || a1 === "") return false;
    if (/(^|[\\/])cli\.(ts|js)$/.test(a1)) return true;
    return (
      fs.realpathSync(a1) === fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (invokedAsCli) {
  main().catch((e) => {
    console.error("[harness] error:", e);
    process.exit(1);
  });
}
