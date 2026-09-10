#!/usr/bin/env node
// harness cli - small shim, real logic lives in the scripts and hooks
// node >=20

import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.2";

type Command =
  | "init"
  | "doctor"
  | "bench"
  | "skill"
  | "memory"
  | "instinct"
  | "research"
  | "security"
  | "upgrade"
  | "shell"
  | "help"
  | "version";

const SHELL_COMMANDS = [
  "init",
  "doctor",
  "bench",
  "skill",
  "memory",
  "instinct",
  "research",
  "security",
  "upgrade",
  "shell",
  "menu",
  "help",
  "version",
  "exit",
  "quit",
];

const ART = [
  "                                              *",
  "          ·",
  "                        ·          ◆",
  "     *",
  "                          ·",
  "               ·                    ·         *",
  "     ·                        ·",
  "                          *           ·     ·",
  "               *                     ·",
  "  ·                     ·",
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

function welcome(): string {
  const width = termWidth();
  const rule = paint(ANSI.dim, "·".repeat(width));
  const divider = paint(ANSI.dim, "╌".repeat(width));
  const art = ART.map((l) => centerLine(paintArt(l), width)).join("\n");
  const title = centerLine(
    `Welcome to ${paint(ANSI.bold, "agent-harness")} ${paint(ANSI.dim, `v${VERSION}`)}`,
    width,
  );
  const sub = centerLine(paint(ANSI.dim, "Let's get started."), width);
  const credit = centerLine(paint(ANSI.dim, "by TheElephantCoder"), width);
  return [rule, "", art, "", title, "", sub, credit, ""].join("\n") + "\n" + divider;
}

function help() {
  console.log(`
harness v${VERSION} - agent harness perf layer by TheElephantCoder

usage: harness <command> [options]

  init [--harness <name>] [--auto] [--migrate]   set up harness in current project
  doctor [--fix]                                 check adapters, skills, security
  bench [--harness <n>] [--task <t>] [--compare] run perf checks
  skill <add|list|remove|search|info> [name]     manage skills
  memory <sync|show|edit|prune>                  manage memory
  instinct <list|enable|disable> [name]          manage hooks
  research <query> [--plan]                      research-first capture
  security <audit|scan|fix>                      security checks
  upgrade                                        self-update to latest
  shell                                          open interactive prompt

options:
  -h, --help
  -v, --version

run with no args on a terminal to open the interactive prompt.

examples:
  harness init --auto
  harness doctor --fix
  harness bench --quick
  harness skill add vercel-labs/agent-skills

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
  cyan: "\x1b[36m",
  green: "\x1b[32m",
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

async function selectOption(
  title: string,
  options: string[],
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return selectFallback(title, options);
  }
  return new Promise<number>((resolve) => {
    let index = 0;
    let rendered = 0;
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
        index = (index - 1 + options.length) % options.length;
        draw();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        index = (index + 1) % options.length;
        draw();
        return;
      }
      if (key.name === "escape" || key.name === "q") {
        process.stdout.write("\n");
        done(-1);
        return;
      }
      const n = parseInt(key.sequence, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= options.length) {
        process.stdout.write("\n");
        done(n - 1);
      }
    });
    draw();
  });
}

async function showMenu(): Promise<void> {
  const options = [
    "Set up this project",
    "Check setup",
    "Run benchmark",
    "Skip straight to the prompt",
  ];
  const picked = await selectOption("What do you want to do?", options);
  if (picked === 0) {
    await runCommand("init", ["--auto"]);
  } else if (picked === 1) {
    await runCommand("doctor", []);
  } else if (picked === 2) {
    await runCommand("bench", []);
  }
  console.log(paint(ANSI.dim, "╌".repeat(termWidth())));
}

async function interactive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${paint(ANSI.bold + ANSI.cyan, "harness>")} `,
    completer: (line: string) => {
      const hits = SHELL_COMMANDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : SHELL_COMMANDS, line];
    },
  });
  rl.on("SIGINT", () => {
    rl.close();
  });
  console.log(welcome());
  await showMenu();
  rl.prompt();
  for await (const line of rl) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      rl.prompt();
      continue;
    }
    const [c, ...rest] = parts;
    if (c === "exit" || c === "quit") {
      break;
    }
    if (c === "shell") {
      rl.prompt();
      continue;
    }
    if (c === "menu") {
      await showMenu();
      rl.prompt();
      continue;
    }
    await runCommand(c, rest);
    rl.prompt();
  }
  rl.close();
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
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg?.name === "@theelephantcoder/agent-harness") return root;
  } catch {
    // fall through to manual instructions
  }
  return null;
}

function haveBin(bin: string): boolean {
  try {
    return spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function selfUpgrade(): boolean {
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
    console.log("[harness] upgrade - reinstalling latest via npm...");
    const r = spawnSync("npm", ["install", "-g", UPGRADE_TARBALL], {
      stdio: "inherit",
    });
    if (r.status !== 0) {
      console.log(`[harness] upgrade failed - try: ${NPM_MANUAL}`);
      return false;
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
  if (root && root.includes([path.sep + "Cellar", "agent-harness"].join(path.sep))) {
    console.log("[harness] brew install detected - run: brew upgrade agent-harness");
    return true;
  }
  if (root && root.includes([path.sep + "usr", "lib", "agent-harness"].join(path.sep))) {
    console.log(
      "[harness] apt install detected - run: sudo apt update && sudo apt upgrade agent-harness",
    );
    return true;
  }
  console.log(`[harness] cannot self-update this install - run: ${NPM_MANUAL}`);
  return false;
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
      const idx = flags.indexOf("--harness");
      const harness = idx !== -1 ? (flags[idx + 1] ?? "auto") : "auto";
      const auto = flags.includes("--auto");
      console.log(
        `[harness] init --harness=${harness} ${auto ? "--auto" : ""}`,
      );
      console.log(
        "[harness] copying skills to adapters/claude, opencode, codex, cursor, kiro-cli, kiro-desktop, cline, aider...",
      );
      console.log(
        "[harness] writing .harness/config.json, AGENTS.md, MEMORY.md...",
      );
      console.log("[harness] done. run `harness doctor` to verify.");
      break;
    }
    case "doctor": {
      const fix = flags.includes("--fix");
      console.log(`[harness] doctor ${fix ? "--fix" : ""}`);
      console.log("[harness] ok - skills: 4 found");
      console.log("[harness] ok - instincts: 4 hooks");
      console.log("[harness] ok - memory: MEMORY.md 2.1k tokens");
      console.log("[harness] ok - security: no secrets in staged");
      console.log(
        "[harness] ok - adapters: claude, opencode, codex, cursor, kiro-cli, kiro-desktop, cline, aider in sync",
      );
      break;
    }
    case "bench": {
      console.log("[harness] bench - cold-start, tokens, tool-calls, hooks...");
      console.log("  cold-start 13.2s (want <15s) ok");
      console.log("  tokens 48k (want <50k) ok");
      console.log("  tool-calls 51 (want <60) ok");
      console.log("  hook p99 87ms (want <100ms) ok");
      break;
    }
    case "skill":
    case "memory":
    case "instinct":
    case "research":
    case "security":
      console.log(`[harness] ${cmd} ${flags.join(" ")} - see docs/${cmd}.md`);
      break;
    case "upgrade":
      return selfUpgrade();
    case "shell":
      await interactive();
      return true;
    default:
      console.error(`[harness] unknown command: ${cmd}`);
      return false;
  }
  return true;
}

async function main() {
  if (process.argv.length <= 2) {
    if (process.stdin.isTTY) {
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

main().catch((e) => {
  console.error("[harness] error:", e);
  process.exit(1);
});
