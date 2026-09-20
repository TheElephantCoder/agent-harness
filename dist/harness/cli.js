#!/usr/bin/env node
// harness cli - small shim, real logic lives in the scripts and hooks
// node >=20
import * as readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
export const VERSION = "0.2.0";
const SHELL_COMMANDS = [
    "init",
    "doctor",
    "status",
    "bench",
    "skill",
    "memory",
    "instinct",
    "research",
    "security",
    "upgrade",
    "shell",
    "optimize",
    "optimizations",
    "adapter",
    "map",
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
function termWidth() {
    const w = process.stdout.columns;
    return typeof w === "number" && w > 20 ? w : 80;
}
function centerLine(line, width) {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    const pad = Math.max(0, Math.floor((width - plain.length) / 2));
    return " ".repeat(pad) + line;
}
function paintArt(line) {
    return line
        .split("")
        .map((ch) => {
        if (ch === "◆")
            return paint(ANSI.magenta + ANSI.bold, ch);
        if (ch === "*")
            return paint(ANSI.cyan, ch);
        return paint(ANSI.dim, ch);
    })
        .join("");
}
function welcome() {
    const width = termWidth();
    const rule = paint(ANSI.dim, "·".repeat(width));
    const divider = paint(ANSI.dim, "╌".repeat(width));
    const art = ART.map((l) => centerLine(paintArt(l), width)).join("\n");
    const title = centerLine(`Welcome to ${paint(ANSI.bold, "agent-harness")} ${paint(ANSI.dim, `v${VERSION}`)}`, width);
    const sub = centerLine(paint(ANSI.dim, "Let's get started."), width);
    const credit = centerLine(paint(ANSI.dim, "by TheElephantCoder"), width);
    return ([rule, "", art, "", title, "", sub, credit, ""].join("\n") + "\n" + divider);
}
function help() {
    console.log(`
harness v${VERSION} - agent harness perf layer by TheElephantCoder

usage: harness <command> [options]

  init [--harness <name>] [--auto] [--migrate]   install into current project
  doctor [--fix] [--strict]                      verify install and project
  status                                         project snapshot: memory, skills, hooks, last bench
  bench [--compare] [--quick]                    measure costs, save baseline
  optimize                                       prune memory, repair, report savings
  optimizations [enable|disable] [name|all]      list, toggle optimizations
  map                                            index repo to .harness/MAP.md
  skill <list|search|info|add|remove|verify> ...  list, search, show, fetch skills
  memory <show|prune|sync|edit> [note]             show, prune, append, edit MEMORY.md
  instinct <list|enable|disable> [name]          list, toggle hooks
  research <query>                               capture a finding stub
  security <audit|scan> [--staged]               run the audit script
  adapter <list|add> [name]                       list, scaffold harnesses
  upgrade                                        self-update to latest
  shell                                          open interactive prompt

options:
  -h, --help
  -v, --version

run with no args on a terminal to open the interactive prompt.

examples:
  harness init --auto
  harness doctor --fix
  harness bench --quick --compare
  harness optimize

https://github.com/TheElephantCoder/agent-harness
`);
}
function parseArgs(argv) {
    const cmd = (argv[2] ?? "help");
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
function useColor() {
    return (!!process.stdout.isTTY &&
        !process.env.NO_COLOR &&
        process.env.TERM !== "dumb");
}
function paint(code, text) {
    return useColor() ? `${code}${text}${ANSI.reset}` : text;
}
async function selectFallback(title, options) {
    console.log(paint(ANSI.bold, title));
    options.forEach((o, i) => {
        console.log(`  ${i + 1}. ${o}`);
    });
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const answer = await new Promise((resolve) => {
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
async function selectOption(title, options) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return selectFallback(title, options);
    }
    return new Promise((resolve) => {
        let index = 0;
        let rendered = 0;
        let finished = false;
        // first digit of a two-digit option number, with its commit timer.
        let pendingDigit = 0;
        let pendingTimer = null;
        const clearPending = () => {
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                pendingTimer = null;
            }
            pendingDigit = 0;
        };
        const stdin = process.stdin;
        const hint = paint(ANSI.dim, "↑↓ to move · enter to select · type a number");
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
        const done = (n) => {
            if (finished)
                return;
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
                if (d >= 1 && (d * 10 > options.length || options.length < 10)) {
                    process.stdout.write("\n");
                    done(d - 1);
                    return;
                }
                if (d >= 1) {
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
async function askQuestion(prompt) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        const answer = await new Promise((resolve) => {
            rl.question(paint(ANSI.cyan, `${prompt} `), (a) => {
                resolve(a.trim());
            });
            rl.on("close", () => resolve(""));
        });
        return answer;
    }
    catch {
        return "";
    }
    finally {
        try {
            rl.close();
        }
        catch {
            // ignore
        }
    }
}
async function pickAdapter(title) {
    const root = selfRoot();
    if (!root) {
        console.log("[harness] adapter - cannot locate install");
        return null;
    }
    const names = listAdapters(root)
        .filter((a) => a.json)
        .map((a) => a.name);
    const picked = await selectOption(title, [...names, "Back"]);
    if (picked < 0 || picked >= names.length)
        return null;
    return names[picked];
}
async function showMenu() {
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
        "Skip straight to the prompt",
    ];
    const picked = await selectOption("What do you want to do?", options);
    if (picked === 0) {
        await setupMenu();
    }
    else if (picked === 1) {
        await checkMenu();
    }
    else if (picked === 2) {
        await runCommand("status", []);
    }
    else if (picked === 3) {
        await benchMenu();
    }
    else if (picked === 4) {
        await runCommand("optimize", []);
    }
    else if (picked === 5) {
        await showOptimizationsMenu();
    }
    else if (picked === 6) {
        await runCommand("map", []);
    }
    else if (picked === 7) {
        await skillsMenu();
    }
    else if (picked === 8) {
        await memoryMenu();
    }
    else if (picked === 9) {
        await instinctMenu();
    }
    else if (picked === 10) {
        await researchMenu();
    }
    else if (picked === 11) {
        await securityMenu();
    }
    else if (picked === 12) {
        await adapterMenu();
    }
    else if (picked === 13) {
        await runCommand("upgrade", []);
    }
    console.log(paint(ANSI.dim, "╌".repeat(termWidth())));
}
async function setupMenu() {
    const picked = await selectOption("Set up this project", [
        "Auto-detect + install",
        "Install for a specific harness",
        "Migrate (fill gaps)",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("init", ["--auto"]);
    }
    else if (picked === 1) {
        const name = await pickAdapter("Install for which harness?");
        if (name) {
            const initialized = fs.existsSync(path.join(process.cwd(), ".harness", "config.json"));
            await runCommand("init", initialized ? ["--harness", name, "--migrate"] : ["--harness", name]);
        }
    }
    else if (picked === 2) {
        await runCommand("init", ["--migrate"]);
    }
}
async function checkMenu() {
    const picked = await selectOption("Check setup", [
        "Check",
        "Check + fix",
        "Strict check",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("doctor", []);
    }
    else if (picked === 1) {
        await runCommand("doctor", ["--fix"]);
    }
    else if (picked === 2) {
        await runCommand("doctor", ["--strict"]);
    }
}
async function benchMenu() {
    const picked = await selectOption("Run benchmark", [
        "Quick",
        "Full",
        "Compare with baseline",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("bench", ["--quick"]);
    }
    else if (picked === 1) {
        await runCommand("bench", []);
    }
    else if (picked === 2) {
        await runCommand("bench", ["--compare"]);
    }
}
async function skillsMenu() {
    const picked = await selectOption("Skills", [
        "List",
        "Search",
        "Show info",
        "Add",
        "Remove",
        "Verify",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("skill", ["list"]);
    }
    else if (picked === 1) {
        const q = await askQuestion("Search skills for?");
        if (q)
            await runCommand("skill", ["search", q]);
    }
    else if (picked === 2) {
        const n = await askQuestion("Which skill?");
        if (n)
            await runCommand("skill", ["info", n]);
    }
    else if (picked === 3) {
        const s = await askQuestion("Add what? (owner/repo, URL, or --path dir)");
        if (s)
            await runCommand("skill", ["add", ...s.split(/\s+/)]);
    }
    else if (picked === 4) {
        const n = await askQuestion("Remove which added skill?");
        if (n)
            await runCommand("skill", ["remove", n]);
    }
    else if (picked === 5) {
        await runCommand("skill", ["verify"]);
    }
}
async function memoryMenu() {
    const picked = await selectOption("Memory", [
        "Show",
        "Prune",
        "Sync a note",
        "Edit",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("memory", ["show"]);
    }
    else if (picked === 1) {
        await runCommand("memory", ["prune"]);
    }
    else if (picked === 2) {
        const n = await askQuestion("Note to append?");
        if (n)
            await runCommand("memory", ["sync", n]);
    }
    else if (picked === 3) {
        await runCommand("memory", ["edit"]);
    }
}
async function instinctMenu() {
    const picked = await selectOption("Instincts", [
        "List",
        "Enable",
        "Disable",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("instinct", ["list"]);
    }
    else if (picked === 1 || picked === 2) {
        const n = await askQuestion(`${picked === 1 ? "Enable" : "Disable"} which hook?`);
        if (n)
            await runCommand("instinct", [picked === 1 ? "enable" : "disable", n]);
    }
}
async function researchMenu() {
    const picked = await selectOption("Research", [
        "List findings",
        "Capture query",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("research", []);
    }
    else if (picked === 1) {
        const q = await askQuestion("Query to capture?");
        if (q)
            await runCommand("research", [q]);
    }
}
async function securityMenu() {
    const picked = await selectOption("Security", [
        "Audit",
        "Staged scan",
        "Back",
    ]);
    if (picked === 0) {
        await runCommand("security", ["audit"]);
    }
    else if (picked === 1) {
        await runCommand("security", ["scan"]);
    }
}
async function adapterMenu() {
    const picked = await selectOption("Adapters", ["List", "Add", "Back"]);
    if (picked === 0) {
        await runCommand("adapter", ["list"]);
    }
    else if (picked === 1) {
        const n = await askQuestion("New adapter name? (lowercase-hyphen)");
        if (n)
            await runCommand("adapter", ["add", n]);
    }
}
async function showOptimizationsMenu() {
    for (;;) {
        const opts = readOptimizations(process.cwd());
        console.log("[harness] optimizations (all on by default):");
        const names = OPTIMIZATIONS.map((o) => o.name);
        names.forEach((n, i) => {
            const o = OPTIMIZATIONS[i];
            console.log(`  ${i + 1}. ${n} [${o.scope}] ${opts[n] ? "on" : "off"} - ${o.desc}`);
        });
        console.log(`  ${names.length + 1}. Back`);
        const picked = await selectOption("Toggle which?", [
            ...names.map((n) => `toggle ${n}`),
            "Back",
        ]);
        if (picked < 0 || picked >= names.length)
            return;
        const name = names[picked];
        if (opts[name]) {
            cmdOptimizations(["disable", name]);
        }
        else {
            cmdOptimizations(["enable", name]);
        }
    }
}
// tab-completion for the prompt: command names, then subcommands,
// flags, and installed skill/hook names. exported for tests.
export function completeLine(line) {
    const parts = line.split(/\s+/);
    if (parts.length <= 1) {
        const hits = SHELL_COMMANDS.filter((c) => c.startsWith(line));
        return [hits.length ? hits : SHELL_COMMANDS, line];
    }
    const [cmd, ...rest] = parts;
    const subs = {
        skill: ["list", "search", "info", "add", "remove", "verify"],
        memory: ["show", "prune", "sync", "edit"],
        instinct: ["list", "enable", "disable"],
        adapter: ["list", "add"],
        security: ["audit", "scan"],
        optimizations: ["enable", "disable"],
    };
    const flagSets = {
        init: ["--auto", "--harness", "--migrate"],
        doctor: ["--fix", "--strict"],
        bench: ["--quick", "--compare"],
        security: ["--staged"],
    };
    const last = rest[rest.length - 1] ?? "";
    // `skill info <name>`: complete installed skill names.
    if (cmd === "skill" && rest[0] === "info" && rest.length === 2) {
        const root = selfRoot();
        const names = root ? listSkills(root).map((s) => s.name) : [];
        const hits = names.filter((n) => n.startsWith(last));
        return [hits.length ? hits : names, last];
    }
    // `instinct enable|disable <name>`: complete hook paths (substring match).
    if (cmd === "instinct" &&
        (rest[0] === "enable" || rest[0] === "disable") &&
        rest.length === 2) {
        const root = selfRoot();
        const names = root ? listHooks(root) : [];
        const hits = names.filter((n) => n.includes(last));
        return [hits.length ? hits : names, last];
    }
    // `optimizations enable|disable <name>`: complete toggle names + all.
    if (cmd === "optimizations" &&
        (rest[0] === "enable" || rest[0] === "disable") &&
        rest.length === 2) {
        const names = [...OPTIMIZATIONS.map((o) => o.name), "all"];
        const hits = names.filter((n) => n.startsWith(last));
        return [hits.length ? hits : names, last];
    }
    const words = [...(subs[cmd] ?? []), ...(flagSets[cmd] ?? [])];
    const hits = words.filter((w) => w.startsWith(last));
    return [hits.length ? hits : words, last];
}
async function interactive() {
    console.log(welcome());
    await showMenu();
    // command history persists across sessions in .harness/history, but only
    // in initialized projects: creating .harness/ here would fake init state.
    const hDir = path.join(process.cwd(), ".harness");
    const histFile = path.join(hDir, "history");
    let savedHist = [];
    if (fs.existsSync(hDir)) {
        try {
            savedHist = fs
                .readFileSync(histFile, "utf8")
                .split("\n")
                .filter(Boolean)
                .slice(-100);
        }
        catch {
            // no history yet
        }
    }
    // created after the menus: an earlier readline would auto-close on stdin
    // EOF (piped/closed input) and take prompt() down with it.
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${paint(ANSI.bold + ANSI.cyan, "harness>")} `,
        completer: completeLine,
        historySize: 100,
    });
    const rlHist = rl.history;
    for (const h of savedHist)
        rlHist.unshift(h);
    rl.on("SIGINT", () => {
        rl.close();
    });
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
    if (fs.existsSync(hDir)) {
        try {
            const seen = new Set(savedHist);
            const fresh = rlHist.filter((h) => h.trim() && !seen.has(h));
            const merged = [...savedHist, ...fresh.reverse()].slice(-100);
            fs.writeFileSync(histFile, merged.join("\n") + "\n");
        }
        catch {
            // history is best-effort
        }
    }
    rl.close();
    console.log(paint(ANSI.dim, "bye."));
}
// same tarball the README install uses; registry publish is still pending,
// so self-update reinstalls from here instead of `npm update -g`.
const UPGRADE_TARBALL = "https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/refs/heads/main";
const NPM_MANUAL = `npm install -g ${UPGRADE_TARBALL}`;
// install root of the running copy, or null when it cannot be located.
function selfRoot() {
    try {
        const self = fs.realpathSync(fileURLToPath(import.meta.url));
        const root = path.dirname(path.dirname(path.dirname(self)));
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        if (pkg?.name === "@theelephantcoder/agent-harness")
            return root;
    }
    catch {
        // fall through to manual instructions
    }
    return null;
}
function haveBin(bin) {
    try {
        return spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
    }
    catch {
        return false;
    }
}
// branch tarballs are cached aggressively (npm served a stale one twice),
// so upgrade resolves main to a sha and installs the immutable sha tarball.
function resolveMainSha() {
    return new Promise((resolve) => {
        try {
            const req = https.get("https://api.github.com/repos/TheElephantCoder/agent-harness/commits/main", {
                headers: {
                    "User-Agent": "agent-harness",
                    Accept: "application/vnd.github+json",
                },
            }, (res) => {
                let body = "";
                res.on("data", (c) => {
                    body += c;
                });
                res.on("end", () => {
                    const m = /"sha"\s*:\s*"([0-9a-f]{40})"/.exec(body);
                    resolve(res.statusCode === 200 && m ? m[1] : null);
                });
            });
            req.setTimeout(10000, () => {
                req.destroy();
                resolve(null);
            });
            req.on("error", () => resolve(null));
        }
        catch {
            resolve(null);
        }
    });
}
function plainLen(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
const UPGRADE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function useUpgradeBar() {
    return (!!process.stdout.isTTY && process.env.TERM !== "dumb" && termWidth() >= 50);
}
function upgradeBar(pct, stage, frame) {
    const width = termWidth();
    const head = `upgrade ${frame} `;
    const tail = ` ${Math.round(pct)}% ${stage}`;
    const barWidth = Math.max(10, width - plainLen(head) - plainLen(tail) - 2);
    const filled = Math.min(barWidth, Math.round((pct / 100) * barWidth));
    const bar = paint(ANSI.cyan, "█".repeat(filled)) +
        paint(ANSI.dim, "░".repeat(barWidth - filled));
    return `\r${head}[${bar}]${tail}`;
}
// npm quiets down when piped, so its output is captured and only the
// tail is shown on failure. the bar creeps toward 90% while npm works.
function runNpmUpgrade(url) {
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
async function animatedNpmUpgrade(pinned, label) {
    let frame = 0;
    let pct = 18;
    let stage = `reinstalling ${label}`;
    const draw = () => {
        process.stdout.write(upgradeBar(pct, stage, UPGRADE_FRAMES[frame % UPGRADE_FRAMES.length]));
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
    }
    finally {
        clearInterval(tick);
        process.stdout.write("\x1b[?25h\n");
    }
}
async function selfUpgrade() {
    const root = selfRoot();
    if (root && fs.existsSync(path.join(root, ".git"))) {
        console.log("[harness] source checkout - run: git pull");
        return true;
    }
    const npmManaged = !!root &&
        root.includes(["node_modules", "@theelephantcoder", "agent-harness"].join(path.sep));
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
                if (tail)
                    console.log(tail);
                console.log(`[harness] upgrade failed - try: ${NPM_MANUAL}`);
                return false;
            }
        }
        else {
            console.log(`[harness] upgrade - reinstalling ${sha ? sha.slice(0, 7) : "latest"} via npm...`);
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
        }
        catch {
            // keep compiled-in VERSION
        }
        console.log(`[harness] upgraded to v${v} - takes effect on next run`);
        return true;
    }
    if (root &&
        root.includes([path.sep + "Cellar", "agent-harness"].join(path.sep))) {
        console.log("[harness] brew install detected - run: brew upgrade agent-harness");
        return true;
    }
    if (root &&
        root.includes([path.sep + "usr", "lib", "agent-harness"].join(path.sep))) {
        console.log("[harness] apt install detected - run: sudo apt update && sudo apt upgrade agent-harness");
        return true;
    }
    console.log(`[harness] cannot self-update this install - run: ${NPM_MANUAL}`);
    return false;
}
// ---------- real inspection: everything below measures the disk ----------
function readText(p) {
    try {
        return fs.readFileSync(p, "utf8");
    }
    catch {
        return null;
    }
}
// ~4 chars per token for markdown. always printed with a ~ prefix.
export function estTokens(text) {
    return Math.ceil(text.length / 4);
}
export function fmtTok(t) {
    return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`;
}
export function parseFrontmatter(text) {
    const m = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!m)
        return null;
    const out = {};
    for (const line of m[1].split("\n")) {
        const i = line.indexOf(":");
        if (i === -1)
            continue;
        out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    if (!out.name || !out.description)
        return null;
    return { name: out.name, desc: out.description };
}
function listSkills(root) {
    let entries = [];
    try {
        entries = fs.readdirSync(path.join(root, "skills")).sort();
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        const f = path.join(root, "skills", e, "SKILL.md");
        const text = readText(f);
        if (text === null)
            continue;
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
function listHooks(root) {
    let groups = [];
    try {
        groups = fs.readdirSync(path.join(root, "instincts")).sort();
    }
    catch {
        return [];
    }
    const out = [];
    for (const g of groups) {
        let files = [];
        try {
            files = fs.readdirSync(path.join(root, "instincts", g)).sort();
        }
        catch {
            continue;
        }
        for (const f of files) {
            if (f.endsWith(".sh"))
                out.push(path.join("instincts", g, f));
        }
    }
    return out;
}
function listAdapters(root, sub = "adapters") {
    const base = path.join(root, sub);
    let entries = [];
    try {
        entries = fs.readdirSync(base).sort();
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        const d = path.join(base, e);
        try {
            if (!fs.statSync(d).isDirectory())
                continue;
        }
        catch {
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
            }
            else {
                out.push({ name: json.name, json, error: null });
            }
        }
        catch {
            out.push({ name: e, json: null, error: "invalid JSON" });
        }
    }
    return out;
}
function isExec(p) {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function timeMs(fn) {
    const t0 = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t0) / 1e6;
}
function runHook(abs, timeoutMs) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync("bash", [abs], {
        input: "",
        timeout: timeoutMs,
        stdio: ["pipe", "ignore", "ignore"],
    });
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: r.status };
}
const AUTO_MARKERS = {
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
export function stripFm(text) {
    return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}
// first "# comment" line of a hook script (shebang excluded by the space).
function hookBlurb(root, rel) {
    const text = readText(path.join(root, rel));
    if (text === null)
        return rel;
    for (const line of text.split("\n")) {
        const m = /^# (.+)/.exec(line);
        if (m)
            return m[1];
    }
    return rel;
}
export function sha256(text) {
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
function cmdInit(flags) {
    const root = selfRoot();
    if (!root) {
        console.log("[harness] init - cannot locate install");
        return false;
    }
    const migrate = flags.includes("--migrate");
    const hi = flags.indexOf("--harness");
    const explicit = hi !== -1
        ? (flags[hi + 1] ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const cwd = process.cwd();
    const manFile = path.join(cwd, ".harness", "config.json");
    const prior = readText(manFile);
    if (prior !== null && !migrate) {
        console.log("[harness] init - already initialized here (use --migrate to fill gaps)");
        return false;
    }
    const adapters = listAdapters(root).filter((a) => a.json);
    const byName = new Map(adapters.map((a) => [a.name, a]));
    for (const c of listAdapters(process.cwd(), path.join(".harness", "adapters"))) {
        if (c.json)
            byName.set(c.name, c);
    }
    let priorHarness = [];
    try {
        if (prior !== null) {
            priorHarness = (JSON.parse(prior).harness ?? []).filter((n) => byName.has(n));
        }
    }
    catch {
        // corrupt manifest: autodetect below, rewrite after
    }
    let names;
    if (explicit.length > 0) {
        const unknown = explicit.filter((n) => !byName.has(n));
        if (unknown.length > 0) {
            console.log(`[harness] init - unknown harness: ${unknown.join(", ")} (try: harness adapter list)`);
            return false;
        }
        names = explicit;
    }
    else if (migrate && priorHarness.length > 0) {
        names = priorHarness;
    }
    else {
        names = adapters
            .map((a) => a.name)
            .filter((n) => {
            const m = AUTO_MARKERS[n] ?? "";
            return m !== "" && fs.existsSync(path.join(process.cwd(), m));
        });
    }
    const tracked = new Set();
    const priorFiles = [];
    if (prior !== null) {
        try {
            const parsed = JSON.parse(prior).files ?? [];
            for (const f of parsed) {
                priorFiles.push(f);
                tracked.add(typeof f === "string" ? f : f.path);
            }
        }
        catch {
            // corrupt manifest: rewrite below
        }
    }
    const written = [];
    const skipped = [];
    const put = (rel, content, exec = false, force = false) => {
        const abs = path.join(cwd, rel);
        if (!force && fs.existsSync(abs)) {
            skipped.push(rel);
            return;
        }
        try {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
            if (exec)
                fs.chmodSync(abs, 0o755);
            written.push({ rel, sha: sha256(content) });
        }
        catch {
            console.log(`[harness] init - could not write ${rel}`);
        }
    };
    const opts = readOptimizations(cwd);
    const agentsSrc = opts["slim-agents"] === false
        ? readText(path.join(root, "AGENTS.md"))
        : (readText(path.join(root, "templates", "AGENTS.project.md")) ??
            readText(path.join(root, "AGENTS.md")));
    const memSrc = readText(path.join(root, "memory", "MEMORY.md"));
    const dests = new Map();
    if (agentsSrc !== null)
        dests.set("AGENTS.md", agentsSrc);
    if (memSrc !== null)
        dests.set("MEMORY.md", memSrc);
    for (const n of names) {
        const j = byName.get(n).json;
        if (j.memoryPath && memSrc !== null)
            dests.set(j.memoryPath, memSrc);
        if (j.agentsPath && agentsSrc !== null)
            dests.set(j.agentsPath, agentsSrc);
    }
    for (const [rel, content] of dests)
        put(rel, content);
    const bodies = new Map();
    for (const s of listSkills(root)) {
        const t = readText(s.file);
        if (t !== null)
            bodies.set(s.name, t);
    }
    const hooks = listHooks(root);
    for (const n of names) {
        const sp = byName.get(n).json.skillPath;
        if (!sp) {
            console.log(`[harness] init - ${n}: fill in skillPath in its adapter.json first`);
            continue;
        }
        if (n === "cursor") {
            // Cursor ignores plain .md here: .mdc + description/alwaysApply = agent-requested.
            for (const [name, body] of bodies) {
                const desc = (parseFrontmatter(body)?.desc ?? name).replace(/\s+/g, " ");
                put(`${sp}/${name}.mdc`, `---\ndescription: ${desc}\nalwaysApply: false\n---\n\n${stripFm(body)}\n`);
            }
        }
        else if (n === "kiro-desktop") {
            // flat steering files with inclusion:auto, verified against Kiro steering doc.
            for (const [name, body] of bodies) {
                const desc = (parseFrontmatter(body)?.desc ?? name).replace(/\s+/g, " ");
                put(`${sp}/${name}.md`, `---\ninclusion: auto\nname: ${name}\ndescription: ${desc}\n---\n\n${stripFm(body)}\n`);
            }
        }
        else if (n === "cline") {
            // .clinerules/ holds flat .md rules, no frontmatter = always active.
            for (const [name, body] of bodies) {
                put(`${sp}/${name}.md`, `# ${name}\n\n${stripFm(body)}\n`);
            }
            const lines = hooks.map((h) => `- \`${h}\`: ${hookBlurb(root, h)}`);
            put(`${sp}/00-harness-instincts.md`, `# Harness instincts\n\nThis project has no hooks system. Before finishing a task, run these checks yourself:\n\n${lines.join("\n")}\n`);
        }
        else if (sp.endsWith(".md")) {
            const content = [...bodies.entries()]
                .map(([name, body]) => `# ${name}\n\n${body}`)
                .join("\n\n---\n\n") + "\n";
            put(sp, content);
        }
        else {
            for (const [name, body] of bodies)
                put(`${sp}/${name}/SKILL.md`, body);
        }
    }
    if (names.includes("aider")) {
        // verified shape: aider loads files listed under read:.
        if (!fs.existsSync(path.join(cwd, ".aider.conf.yml"))) {
            put(".aider.conf.yml", "# written by harness init\nread: CONVENTIONS.md\n");
        }
        else if (!tracked.has(".aider.conf.yml")) {
            console.log("[harness] init - .aider.conf.yml exists, add read: CONVENTIONS.md manually");
        }
    }
    const copied = [];
    const copyHook = (rel) => {
        const text = readText(path.join(root, rel));
        if (text === null)
            return;
        const base = `${path.basename(path.dirname(rel))}--${path.basename(rel)}`;
        put(`.harness/hooks/${base}`, text, true);
        copied.push(base);
    };
    for (const h of hooks)
        copyHook(h);
    copyHook("security/audit.sh");
    if (names.includes("claude")) {
        const rel = ".claude/settings.json";
        if (!fs.existsSync(path.join(cwd, rel))) {
            const entry = (base, matcher, timeout) => ({
                matcher,
                hooks: [
                    { type: "command", command: `./.harness/hooks/${base}`, timeout },
                ],
            });
            const find = (sfx) => copied.find((c) => c.endsWith(sfx));
            const hj = {};
            const hyd = find("session-start--hydrate.sh");
            const grd = find("pre-tool--guard.sh");
            const chk = find("post-edit--check.sh");
            const aud = find("audit.sh");
            if (hyd)
                hj.SessionStart = [entry(hyd, "*", 15000)];
            if (grd)
                hj.PreToolUse = [entry(grd, "Bash|Edit|Write", 5000)];
            if (chk)
                hj.PostToolUse = [entry(chk, "Edit|Write", 5000)];
            if (aud)
                hj.PreCommit = [entry(aud, "*", 10000)];
            put(rel, JSON.stringify({ hooks: hj }, null, 2) + "\n");
        }
        else if (!tracked.has(rel)) {
            console.log("[harness] init - .claude/settings.json exists, merge hooks manually (see docs/cli.md)");
        }
    }
    const findHook = (sfx) => copied.find((c) => c.endsWith(sfx));
    if (names.includes("cursor")) {
        // verified: .cursor/hooks.json v1, exit 2 blocks, seconds, project-root cwd.
        const rel = ".cursor/hooks.json";
        if (!fs.existsSync(path.join(cwd, rel))) {
            const entry = (base, timeout) => ({
                command: `.harness/hooks/${base}`,
                timeout,
            });
            const hj = {};
            const hyd = findHook("session-start--hydrate.sh");
            const grd = findHook("pre-tool--guard.sh");
            const chk = findHook("post-edit--check.sh");
            if (hyd)
                hj.sessionStart = [entry(hyd, 15)];
            if (grd)
                hj.preToolUse = [entry(grd, 5)];
            if (chk)
                hj.afterFileEdit = [entry(chk, 5)];
            put(rel, JSON.stringify({ version: 1, hooks: hj }, null, 2) + "\n");
        }
        else if (!tracked.has(rel)) {
            console.log("[harness] init - .cursor/hooks.json exists, merge hooks manually (see docs/cli.md)");
        }
    }
    if (names.includes("kiro-cli") || names.includes("kiro-desktop")) {
        // verified: .kiro/hooks/*.json v1 schema, seconds, project-root cwd.
        const kh = (nm, trigger, base, timeout) => ({
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
            put(".kiro/hooks/session-hydrate.json", JSON.stringify({
                version: "v1",
                hooks: [
                    kh("harness hydrate on session start", "SessionStart", hyd, 15),
                    kh("harness hydrate on agent spawn", "Agent Spawn", hyd, 15),
                ],
            }, null, 2) + "\n");
        }
        if (grd) {
            put(".kiro/hooks/pre-tool-guard.json", JSON.stringify({
                version: "v1",
                hooks: [kh("harness pre-tool guard", "Pre Tool Use", grd, 5)],
            }, null, 2) + "\n");
        }
        if (chk) {
            put(".kiro/hooks/post-tool-check.json", JSON.stringify({
                version: "v1",
                hooks: [kh("harness post-edit check", "Post Tool Use", chk, 5)],
            }, null, 2) + "\n");
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
            const entry = (matcher, base, timeout) => ({
                matcher,
                hooks: [
                    {
                        type: "command",
                        command: `bash ${root}/.harness/hooks/${base}`,
                        timeout,
                    },
                ],
            });
            const hj = {};
            const hyd = findHook("session-start--hydrate.sh");
            const grd = findHook("pre-tool--guard.sh");
            const chk = findHook("post-edit--check.sh");
            if (hyd)
                hj.SessionStart = [entry("startup|resume", hyd, 15)];
            if (grd)
                hj.PreToolUse = [entry("Bash", grd, 5)];
            if (chk)
                hj.PostToolUse = [entry("Bash", chk, 5)];
            put(rel, JSON.stringify({ hooks: hj }, null, 2) + "\n");
        }
        else if (!tracked.has(rel)) {
            console.log("[harness] init - .codex/hooks.json exists, merge hooks manually (see docs/cli.md); review new hooks with /hooks on first run");
        }
    }
    if (opts["map-index"] !== false) {
        // generated index: always refreshed, even on --migrate.
        const m = buildMap(cwd);
        put(".harness/MAP.md", m.text, false, true);
        console.log(`[harness] init - map: ${m.files} files, ~${fmtTok(m.tokens)} tokens`);
    }
    const files = [
        ...priorFiles,
        ...written.map((w) => ({ path: w.rel, sha: w.sha })),
    ];
    // migrate re-records regenerated files (MAP.md): keep the latest entry per path.
    const seenPaths = new Set();
    const deduped = files
        .reverse()
        .filter((f) => {
        const p = typeof f === "string" ? f : f.path;
        if (seenPaths.has(p))
            return false;
        seenPaths.add(p);
        return true;
    })
        .reverse();
    let priorOpts = {};
    try {
        if (prior !== null)
            priorOpts = JSON.parse(prior).optimizations ?? {};
    }
    catch {
        // corrupt manifest: defaults below
    }
    const optimizations = { ...defaultOptimizations() };
    for (const o of OPTIMIZATIONS) {
        if (typeof priorOpts[o.name] === "boolean")
            optimizations[o.name] = priorOpts[o.name];
    }
    try {
        fs.mkdirSync(path.dirname(manFile), { recursive: true });
        fs.writeFileSync(manFile, JSON.stringify({
            version: VERSION,
            harness: names,
            files: deduped,
            optimizations,
            ts: new Date().toISOString(),
        }, null, 2));
    }
    catch {
        console.log("[harness] init - could not write .harness/config.json");
        return false;
    }
    const scope = names.length > 0 ? names.join(",") : "core only";
    console.log(`[harness] init ${scope} - ${written.length} written, ${skipped.length} skipped (run harness doctor to verify)`);
    return true;
}
function cmdBench(flags) {
    const root = selfRoot();
    if (!root) {
        console.log("[harness] bench - cannot locate install");
        return false;
    }
    const quick = flags.includes("--quick");
    const compare = flags.includes("--compare");
    const runs = quick ? 1 : 3;
    console.log(`[harness] bench - ${runs} run${runs > 1 ? "s" : ""} per hook (tokens are estimates, ~4 chars each)`);
    let ok = true;
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    let cold = 0;
    cold = timeMs(() => {
        spawnSync(process.execPath, [self, "--version"], { stdio: "ignore" });
    });
    const coldOk = cold < 1500;
    if (!coldOk)
        ok = false;
    console.log(`  cold-start ${Math.round(cold)}ms (want <1500ms) ${coldOk ? "ok" : "FAIL"}`);
    const hooks = listHooks(root);
    if (hooks.length === 0) {
        console.log("  hooks: none found FAIL");
        ok = false;
    }
    const hookMs = {};
    for (const h of hooks) {
        let total = 0;
        let status = 0;
        for (let i = 0; i < runs; i++) {
            const r = runHook(path.join(root, h), 10000);
            total += r.ms;
            if (r.status !== 0)
                status = r.status;
        }
        const mean = total / runs;
        hookMs[h] = Math.round(mean * 10) / 10;
        const good = status === 0;
        if (!good)
            ok = false;
        const mark = !good ? "FAIL" : mean > 2000 ? "slow" : "ok";
        console.log(`  hook ${path.basename(h)} mean ${mean.toFixed(0)}ms exit ${status} ${mark}`);
    }
    const skills = listSkills(root);
    const totalTok = skills.reduce((a, s) => a + s.tokens, 0);
    const skillsOk = skills.length > 0 && totalTok < 50000;
    if (!skillsOk)
        ok = false;
    for (const s of skills)
        console.log(`  skill ${s.name} ~${fmtTok(s.tokens)}`);
    console.log(`  skills ${skills.length} files ~${fmtTok(totalTok)} (want <50k) ${skillsOk ? "ok" : "FAIL"}`);
    let adapters = [];
    let valid = 0;
    const adapterMs = timeMs(() => {
        adapters = listAdapters(root);
        valid = adapters.filter((a) => a.json).length;
    });
    const adOk = adapters.length > 0 && valid === adapters.length;
    if (!adOk)
        ok = false;
    for (const a of adapters) {
        if (!a.json)
            console.log(`  adapter ${a.name}: ${a.error} FAIL`);
    }
    console.log(`  adapters ${valid}/${adapters.length} valid in ${adapterMs.toFixed(0)}ms ${adOk ? "ok" : "FAIL"}`);
    const r1 = (n) => Math.round(n * 10) / 10;
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
    };
    const bFile = path.join(process.cwd(), ".harness", "bench.json");
    if (compare) {
        const prev = readText(bFile);
        if (prev === null) {
            console.log("  compare: no baseline yet, saving current");
        }
        else {
            try {
                const p = JSON.parse(prev);
                const d = (c, o) => {
                    const diff = r1(c - o);
                    return `${c} (was ${o}, ${diff > 0 ? "+" : ""}${diff})`;
                };
                console.log(`  compare cold-start ${d(baseline.coldStartMs, p.coldStartMs)}ms`);
                for (const h of Object.keys(hookMs)) {
                    if (p.hooks?.[h] !== undefined) {
                        console.log(`  compare hook ${path.basename(h)} ${d(hookMs[h], p.hooks[h])}ms`);
                    }
                }
                if (p.skillTokens !== undefined) {
                    console.log(`  compare skills ~${fmtTok(totalTok)} (was ~${fmtTok(p.skillTokens)})`);
                }
            }
            catch {
                console.log("  compare: baseline corrupt, overwriting");
            }
        }
    }
    try {
        fs.mkdirSync(path.dirname(bFile), { recursive: true });
        fs.writeFileSync(bFile, JSON.stringify(baseline, null, 2));
        console.log("[harness] baseline saved to .harness/bench.json");
    }
    catch {
        console.log("[harness] warn - could not write .harness/bench.json");
    }
    return ok;
}
const SECRET_PATTERNS = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /AKIA[0-9A-Z]{16}/,
    /ghp_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]+/,
    /xox[bap]-[A-Za-z0-9-]+/,
];
function scanStaged() {
    const hits = [];
    let out = "";
    try {
        const r = spawnSync("git", ["diff", "--cached", "--no-color"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        out = typeof r.stdout === "string" ? r.stdout : "";
    }
    catch {
        return hits;
    }
    let file = "";
    let line = 0;
    for (const l of out.split("\n")) {
        const m = /^\+\+\+ b\/(.+)/.exec(l);
        if (m) {
            file = m[1];
            line = 0;
            continue;
        }
        if (l.startsWith("+") && !l.startsWith("+++")) {
            line += 1;
            if (SECRET_PATTERNS.some((p) => p.test(l)))
                hits.push({ file, line });
        }
    }
    return hits;
}
function fmtAge(ts) {
    const ago = Date.now() - Date.parse(ts);
    if (!isFinite(ago) || ago < 0)
        return "unknown age";
    const min = Math.floor(ago / 60000);
    if (min < 1)
        return "just now";
    if (min < 60)
        return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 48)
        return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}
// project snapshot: init state, memory, findings, baseline, install.
// reads only; never fails, missing pieces are reported as missing.
function cmdStatus() {
    const cwd = process.cwd();
    const hDir = path.join(cwd, ".harness");
    console.log("[harness] status");
    console.log("Project");
    const initState = fs.existsSync(path.join(hDir, "config.json"))
        ? "yes"
        : fs.existsSync(hDir)
            ? "partial (.harness/ without config.json)"
            : "no";
    console.log(`  initialized: ${initState}${initState === "no" ? " (run harness init)" : ""}`);
    const mem = readText(path.join(cwd, "MEMORY.md"));
    console.log(mem === null
        ? "  MEMORY.md: missing"
        : `  MEMORY.md: ~${fmtTok(estTokens(mem))} tokens`);
    let findings = 0;
    try {
        findings = fs
            .readdirSync(path.join(cwd, "research", "findings"))
            .filter((f) => f.endsWith(".md")).length;
    }
    catch {
        // no findings dir
    }
    console.log(`  research findings: ${findings}`);
    const bText = readText(path.join(hDir, "bench.json"));
    if (bText === null) {
        console.log("  last benchmark: none yet (run harness bench)");
    }
    else {
        try {
            const b = JSON.parse(bText);
            const cold = typeof b.coldStartMs === "number"
                ? `, cold-start ${b.coldStartMs}ms`
                : "";
            console.log(`  last benchmark: ${fmtAge(b.ts)}${cold}`);
        }
        catch {
            console.log("  last benchmark: baseline corrupt (run harness bench)");
        }
    }
    const opts = readOptimizations(cwd);
    const on = OPTIMIZATIONS.filter((o) => opts[o.name]).length;
    console.log(`  optimizations: ${on}/${OPTIMIZATIONS.length} on`);
    const root = selfRoot();
    if (root === null) {
        console.log("[harness] status - cannot locate install");
        return true;
    }
    console.log("Install");
    console.log(`  version: ${VERSION}`);
    const skills = listSkills(root);
    console.log(`  skills: ${skills.length} (~${fmtTok(skills.reduce((t, s) => t + s.tokens, 0))} tokens)`);
    const hooks = listHooks(root);
    console.log(`  hooks: ${hooks.length} (${hooks.filter((h) => isExec(path.join(root, h))).length} executable)`);
    const adapters = listAdapters(root);
    console.log(`  adapters: ${adapters.filter((a) => a.json).length}/${adapters.length} valid`);
    return true;
}
function cmdDoctor(flags) {
    const root = selfRoot();
    if (!root) {
        console.log("[harness] doctor - cannot locate install");
        return false;
    }
    const fix = flags.includes("--fix");
    const strict = flags.includes("--strict");
    let ok = true;
    const fail = (s) => {
        console.log(s);
        ok = false;
    };
    const warn = (s) => {
        console.log(s);
        if (strict)
            ok = false;
    };
    const skills = listSkills(root);
    const badFm = skills.filter((s) => !s.fmOk).map((s) => s.name);
    if (skills.length === 0)
        fail("[harness] FAIL - skills: none found");
    else if (badFm.length > 0) {
        fail(`[harness] FAIL - skills frontmatter missing name/description: ${badFm.join(", ")}`);
    }
    else {
        console.log(`[harness] ok - skills: ${skills.length} checked, frontmatter ok`);
    }
    const hooks = listHooks(root);
    const perfOff = readDisabledByPerf(process.cwd());
    const noexec = hooks.filter((h) => !isExec(path.join(root, h)));
    const skippedPerf = noexec.filter((h) => perfOff.has(h));
    const repairable = noexec.filter((h) => !perfOff.has(h));
    if (skippedPerf.length > 0) {
        console.log(`[harness] info - left disabled by optimize: ${skippedPerf.join(", ")}`);
    }
    if (repairable.length > 0) {
        if (fix) {
            let repaired = 0;
            for (const h of repairable) {
                try {
                    fs.chmodSync(path.join(root, h), 0o755);
                    if (isExec(path.join(root, h)))
                        repaired += 1;
                }
                catch {
                    // keep going
                }
            }
            const still = hooks.filter((h) => !isExec(path.join(root, h)) && !perfOff.has(h));
            if (still.length === 0) {
                console.log(`[harness] ok - hooks: repaired exec on ${repaired}, ${hooks.length - skippedPerf.length} executable`);
            }
            else {
                fail(`[harness] FAIL - hooks not executable: ${still.join(", ")}`);
            }
        }
        else {
            fail(`[harness] FAIL - hooks not executable (run --fix): ${repairable.join(", ")}`);
        }
    }
    else if (hooks.length === 0) {
        fail("[harness] FAIL - hooks: none found");
    }
    else {
        console.log(`[harness] ok - hooks: ${hooks.length - skippedPerf.length} executable${skippedPerf.length > 0 ? ` (${skippedPerf.length} disabled by optimize)` : ""}`);
    }
    const adapters = listAdapters(root);
    const bad = adapters.filter((a) => !a.json);
    if (adapters.length === 0)
        fail("[harness] FAIL - adapters: none found");
    else if (bad.length > 0) {
        fail(`[harness] FAIL - adapters invalid: ${bad.map((a) => `${a.name} (${a.error})`).join(", ")}`);
    }
    else {
        console.log(`[harness] ok - adapters: ${adapters.length}/${adapters.length} valid`);
    }
    const tplBad = [];
    for (const a of adapters) {
        if (!a.json || !a.json.transpile || !/^[a-z0-9-]+$/.test(a.name))
            continue;
        const f = path.join(root, "adapters", a.name, "transpile.sh");
        if (!fs.existsSync(f)) {
            tplBad.push(`${a.name} (missing transpile.sh)`);
            continue;
        }
        if (!isExec(f)) {
            if (fix) {
                try {
                    fs.chmodSync(f, 0o755);
                }
                catch {
                    // keep going
                }
            }
            if (!isExec(f))
                tplBad.push(`${a.name} (transpile.sh not executable)`);
        }
    }
    if (tplBad.length > 0) {
        fail(`[harness] FAIL - adapter transpilers: ${tplBad.join(", ")}`);
    }
    else if (adapters.some((a) => a.json && a.json.transpile)) {
        console.log("[harness] ok - adapter transpilers executable");
    }
    const manText = readText(path.join(process.cwd(), ".harness", "config.json"));
    if (manText !== null) {
        try {
            const files = JSON.parse(manText).files ?? [];
            const relOf = (f) => typeof f === "string" ? f : f.path;
            const missing = files
                .map(relOf)
                .filter((f) => !fs.existsSync(path.join(process.cwd(), f)));
            const modified = [];
            for (const f of files) {
                if (typeof f === "string")
                    continue;
                const abs = path.join(process.cwd(), f.path);
                if (!fs.existsSync(abs))
                    continue;
                const text = readText(abs);
                if (text !== null && sha256(text) !== f.sha)
                    modified.push(f.path);
            }
            if (missing.length > 0) {
                fail(`[harness] FAIL - project init files missing: ${missing.join(", ")}`);
            }
            if (modified.length > 0) {
                fail(`[harness] FAIL - project files modified: ${modified.join(", ")} (delete + migrate to restore, or keep your edit)`);
            }
            if (missing.length === 0 && modified.length === 0) {
                console.log(`[harness] ok - project: ${files.length}/${files.length} init files present, hashes match`);
            }
            const { added } = readAddedSkills(process.cwd());
            const addedBad = [];
            for (const a of added) {
                const reason = verifyAddedSkill(process.cwd(), a);
                if (reason)
                    addedBad.push(reason);
            }
            if (addedBad.length > 0) {
                fail(`[harness] FAIL - added skills: ${addedBad.join(", ")}`);
            }
            else if (added.length > 0) {
                console.log(`[harness] ok - added skills: ${added.length} verified`);
            }
        }
        catch {
            fail("[harness] FAIL - project: .harness/config.json corrupt");
        }
    }
    else {
        console.log("[harness] info - project not initialized here (run harness init)");
    }
    const mem = readText(path.join(process.cwd(), "MEMORY.md"));
    const ag = readText(path.join(process.cwd(), "AGENTS.md"));
    if (mem !== null || ag !== null) {
        const t = estTokens((mem ?? "") + (ag ?? ""));
        console.log(`[harness] info - project context ~${fmtTok(t)} tokens (AGENTS.md + MEMORY.md)`);
    }
    if (mem !== null) {
        const t = estTokens(mem);
        if (t > 4000)
            warn(`[harness] warn - MEMORY.md ~${fmtTok(t)} tokens (run harness optimize)`);
        else
            console.log(`[harness] ok - memory: MEMORY.md ~${fmtTok(t)} tokens`);
    }
    const inRepo = (() => {
        try {
            return (spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
                stdio: ["ignore", "pipe", "ignore"],
            }).status === 0);
        }
        catch {
            return false;
        }
    })();
    if (!inRepo) {
        console.log("[harness] info - security: not a git repo, staged scan skipped");
    }
    else {
        const hits = scanStaged();
        if (hits.length > 0) {
            fail(`[harness] FAIL - security: possible secrets in staged (${hits.length}): ${hits
                .slice(0, 5)
                .map((h) => `${h.file}:${h.line}`)
                .join(", ")} - unstage and remove them`);
        }
        else {
            console.log("[harness] ok - security: no secrets in staged");
        }
    }
    return ok;
}
// prune a markdown file to a token budget, archiving overflow. no data loss.
export function pruneFile(abs, budget) {
    const text = readText(abs);
    if (text === null)
        return null;
    const before = estTokens(text);
    if (before <= budget)
        return { before, after: before, moved: 0 };
    const lines = text.split("\n");
    const kept = [];
    let count = 0;
    for (const l of lines) {
        const t = estTokens(l + "\n");
        if (kept.length >= 10 && count + t > budget)
            break;
        kept.push(l);
        count += t;
    }
    const rest = lines.slice(kept.length);
    const archive = path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}.archive.md`);
    const stamp = new Date().toISOString().slice(0, 10);
    try {
        fs.appendFileSync(archive, `\n## pruned ${stamp}\n\n${rest.join("\n")}\n`);
        fs.writeFileSync(abs, kept.join("\n"));
    }
    catch {
        return null;
    }
    return { before, after: estTokens(kept.join("\n")), moved: rest.length };
}
function cmdOptimize() {
    const root = selfRoot();
    if (!root) {
        console.log("[harness] optimize - cannot locate install");
        return false;
    }
    const cwd = process.cwd();
    const opts = readOptimizations(cwd);
    const mem = ["MEMORY.md", path.join(".kiro", "MEMORY.md")]
        .map((f) => path.join(cwd, f))
        .find((f) => fs.existsSync(f));
    if (!mem) {
        console.log("[harness] optimize - no MEMORY.md here (run harness init)");
    }
    else if (opts["prune-memory"] === false) {
        const text = readText(mem);
        console.log(`[harness] info - prune-memory off, MEMORY.md ~${fmtTok(estTokens(text ?? ""))} (enable: harness optimizations enable prune-memory)`);
    }
    else {
        const r = pruneFile(mem, 2000);
        if (!r) {
            console.log("[harness] FAIL - optimize: could not prune MEMORY.md");
            return false;
        }
        if (r.moved === 0) {
            console.log(`[harness] ok - memory ~${fmtTok(r.before)} - under 2k budget, nothing to do`);
        }
        else {
            console.log(`[harness] ok - memory ~${fmtTok(r.before)} -> ~${fmtTok(r.after)}, ${r.moved} lines archived`);
        }
    }
    if (opts["archive-rotate"] !== false && mem) {
        const base = mem.slice(0, -path.extname(mem).length);
        const archive = `${base}.archive.md`;
        const text = readText(archive);
        if (text !== null) {
            const lines = text.split("\n");
            if (lines.length > 500) {
                const trimmed = lines.slice(lines.length - 500);
                try {
                    fs.writeFileSync(archive, trimmed.join("\n"));
                    console.log(`[harness] ok - archive rotated: ${lines.length} -> ${trimmed.length} lines (oldest dropped)`);
                }
                catch {
                    console.log("[harness] warn - could not rotate archive");
                }
            }
        }
    }
    const hooks = listHooks(root);
    let repaired = 0;
    for (const h of hooks) {
        const abs = path.join(root, h);
        if (!isExec(abs)) {
            try {
                fs.chmodSync(abs, 0o755);
                if (isExec(abs))
                    repaired += 1;
            }
            catch {
                // keep going
            }
        }
    }
    if (repaired > 0)
        console.log(`[harness] ok - repaired exec on ${repaired} hooks`);
    if (opts["fast-hooks"] !== false) {
        const times = {};
        for (const h of hooks) {
            let total = 0;
            for (let i = 0; i < 3; i++)
                total += runHook(path.join(root, h), 10000).ms;
            times[h] = Math.round((total / 3) * 10) / 10;
        }
        const slow = slowHooks(times, 2000);
        if (slow.length > 0) {
            const manFile = path.join(cwd, ".harness", "config.json");
            let man = {
                version: VERSION,
                harness: [],
                files: [],
            };
            const manText = readText(manFile);
            if (manText !== null) {
                try {
                    man = JSON.parse(manText);
                }
                catch {
                    // keep shell below
                }
            }
            const disabled = new Set(Array.isArray(man.disabledByPerf)
                ? man.disabledByPerf.filter((x) => typeof x === "string")
                : []);
            let dropped = 0;
            for (const h of slow) {
                try {
                    fs.chmodSync(path.join(root, h), 0o644);
                    disabled.add(h);
                    dropped += 1;
                }
                catch {
                    // keep going
                }
            }
            man.disabledByPerf = [...disabled];
            try {
                fs.mkdirSync(path.dirname(manFile), { recursive: true });
                fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
            }
            catch {
                console.log("[harness] warn - could not record disabled hooks");
            }
            console.log(`[harness] ok - fast-hooks: disabled ${dropped} slow hook(s) over 2s mean: ${slow.join(", ")} (re-enable: harness instinct enable <name>)`);
        }
    }
    const skills = listSkills(root);
    const total = skills.reduce((a, s) => a + s.tokens, 0);
    const top = [...skills].sort((a, b) => b.tokens - a.tokens)[0];
    console.log(`[harness] ok - skills ${skills.length} files ~${fmtTok(total)} total${top ? `, largest ${top.name} ~${fmtTok(top.tokens)}` : ""}`);
    return true;
}
export function slugify(s) {
    return (s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "note");
}
function cmdMemorySync(note) {
    const memFile = path.join(process.cwd(), "MEMORY.md");
    if (readText(memFile) === null) {
        console.log("[harness] memory - no MEMORY.md here (run harness init)");
        return false;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    try {
        fs.appendFileSync(memFile, `\n- (${stamp}) ${note}\n`);
    }
    catch {
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
    console.log(`[harness] ok - memory synced (~${fmtTok(r.after)}${r.moved > 0 ? `, ${r.moved} lines archived` : ""})`);
    return true;
}
function fetchTarball(url, maxBytes) {
    return new Promise((resolve) => {
        try {
            const req = https.get(url, { headers: { "User-Agent": "agent-harness" } }, (res) => {
                if (res.statusCode !== 200 ||
                    !res.headers["content-type"]?.includes("gzip")) {
                    res.resume();
                    resolve(null);
                    return;
                }
                const chunks = [];
                let size = 0;
                res.on("data", (c) => {
                    size += c.length;
                    if (size > maxBytes) {
                        req.destroy();
                        resolve(null);
                        return;
                    }
                    chunks.push(c);
                });
                res.on("end", () => resolve(Buffer.concat(chunks)));
            });
            req.setTimeout(15000, () => {
                req.destroy();
                resolve(null);
            });
            req.on("error", () => resolve(null));
        }
        catch {
            resolve(null);
        }
    });
}
function tarList(archive) {
    const r = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
    if (r.status !== 0)
        return [];
    return r.stdout.split("\n").filter(Boolean);
}
function tarRead(archive, entry) {
    const r = spawnSync("tar", ["-xzOf", archive, entry], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
    });
    if (r.status !== 0)
        return null;
    return r.stdout;
}
export function sanitizeSkillName(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
}
function fetchText(url, maxBytes) {
    return new Promise((resolve) => {
        try {
            const req = https.get(url, { headers: { "User-Agent": "agent-harness" } }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    resolve(null);
                    return;
                }
                const chunks = [];
                let size = 0;
                res.on("data", (c) => {
                    size += c.length;
                    if (size > maxBytes) {
                        req.destroy();
                        resolve(null);
                        return;
                    }
                    chunks.push(c);
                });
                res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            });
            req.setTimeout(15000, () => {
                req.destroy();
                resolve(null);
            });
            req.on("error", () => resolve(null));
        }
        catch {
            resolve(null);
        }
    });
}
// first SKILL.md in a tarball: root SKILL.md preferred, then skills/*/SKILL.md.
function extractSkillBody(buf) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "harness-skill-")), "pkg.tgz");
    try {
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        fs.writeFileSync(tmp, buf);
        const entries = tarList(tmp);
        const top = entries.length > 0 ? entries[0].split("/")[0] + "/" : "";
        const cands = entries
            .filter((e) => e === `${top}SKILL.md` || /^[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(e))
            .sort((a, b) => a.length - b.length);
        return cands.length > 0 ? tarRead(tmp, cands[0]) : null;
    }
    catch {
        return null;
    }
    finally {
        try {
            fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
        }
        catch {
            // best effort cleanup
        }
    }
}
function finishSkillAdd(body, repoLabel, ref) {
    const cwd = process.cwd();
    const fm = parseFrontmatter(body);
    if (!fm) {
        console.log(`[harness] skill add - ${repoLabel} SKILL.md lacks name/description frontmatter`);
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
    }
    catch {
        console.log(`[harness] skill add - could not write ${rel}`);
        return false;
    }
    const manFile = path.join(cwd, ".harness", "config.json");
    let man = {
        version: VERSION,
        harness: [],
        files: [],
    };
    const manText = readText(manFile);
    if (manText !== null) {
        try {
            man = JSON.parse(manText);
        }
        catch {
            console.log("[harness] skill add - .harness/config.json corrupt");
            return false;
        }
    }
    const added = (man.addedSkills ?? []);
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
    }
    catch {
        console.log("[harness] skill add - could not update .harness/config.json");
        return false;
    }
    console.log(`[harness] ok - skill ${name} from ${ref === "-" ? repoLabel : `${repoLabel}@${ref}`} pinned in manifest`);
    return true;
}
function addFromDir(dir) {
    const abs = path.resolve(dir.replace(/^~(?=\/|$)/, os.homedir()));
    let stat = null;
    try {
        stat = fs.statSync(abs);
    }
    catch {
        stat = null;
    }
    if (!stat || !stat.isDirectory()) {
        console.log(`[harness] skill add - not a directory: ${dir}`);
        return false;
    }
    const cands = [];
    const direct = path.join(abs, "SKILL.md");
    if (fs.existsSync(direct))
        cands.push(direct);
    const skillsDir = path.join(abs, "skills");
    try {
        for (const e of fs.readdirSync(skillsDir).sort()) {
            const f = path.join(skillsDir, e, "SKILL.md");
            if (fs.existsSync(f))
                cands.push(f);
        }
    }
    catch {
        // no skills/ dir is fine
    }
    if (cands.length === 0) {
        console.log(`[harness] skill add - no SKILL.md in ${dir} (want SKILL.md at root or skills/<name>/SKILL.md)`);
        return false;
    }
    const body = readText(cands[0]);
    if (body === null) {
        console.log(`[harness] skill add - cannot read ${cands[0]}`);
        return false;
    }
    return finishSkillAdd(body, `local:${abs}`, "-");
}
async function addFromUrl(url) {
    // codeload URLs carry tar.gz as a path segment (.../tar.gz/<ref>).
    const pathPart = url.split(/[?#]/)[0].toLowerCase();
    const segs = new Set(pathPart.split("/"));
    const isMd = pathPart.endsWith(".md");
    const isTarball = !isMd &&
        (segs.has("tar.gz") ||
            segs.has("tgz") ||
            pathPart.endsWith(".tar.gz") ||
            pathPart.endsWith(".tgz") ||
            pathPart.endsWith(".tar") ||
            pathPart.endsWith(".gz"));
    if (!isMd && !isTarball) {
        console.log("[harness] skill add - want a .md file or .tar.gz archive URL (or owner/repo, or --path)");
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
        console.log(`[harness] skill add - no SKILL.md in ${url} (want SKILL.md at root or skills/<name>/SKILL.md)`);
        return false;
    }
    return finishSkillAdd(body, url, "-");
}
async function cmdSkillAdd(args) {
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
    if (spec.startsWith(".") ||
        spec.startsWith("/") ||
        spec.startsWith("~") ||
        fs.existsSync(path.resolve(spec))) {
        return addFromDir(spec);
    }
    const m = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_.\-/]+))?$/.exec(spec);
    if (!m) {
        console.log("[harness] skill add - want owner/repo[@ref], an https URL, or --path <dir>");
        return false;
    }
    const [, repo] = m;
    const givenRef = m[2];
    for (const ref of givenRef ? [givenRef] : ["main", "master"]) {
        const url = `https://codeload.github.com/${repo}/tar.gz/${ref}`;
        console.log(`[harness] skill add - fetching ${repo}@${ref}...`);
        const buf = await fetchTarball(url, 8 * 1024 * 1024);
        if (!buf)
            continue;
        const body = extractSkillBody(buf);
        if (!body) {
            console.log(`[harness] skill add - no SKILL.md in ${repo}@${ref} (want SKILL.md at root or skills/<name>/SKILL.md)`);
            return false;
        }
        return finishSkillAdd(body, repo, ref);
    }
    console.log(`[harness] skill add - could not fetch ${repo} (tried main, master)`);
    return false;
}
function readAddedSkills(cwd) {
    const manText = readText(path.join(cwd, ".harness", "config.json"));
    if (manText === null)
        return { added: [], corrupt: false };
    try {
        const v = JSON.parse(manText).addedSkills ?? [];
        return { added: Array.isArray(v) ? v : [], corrupt: false };
    }
    catch {
        return { added: [], corrupt: true };
    }
}
function verifyAddedSkill(cwd, a) {
    const p = path.join(cwd, ".harness", "skills", String(a.name ?? ""), "SKILL.md");
    const text = readText(p);
    if (text === null)
        return `${a.name} (missing)`;
    if (sha256(text) !== a.sha256)
        return `${a.name} (modified)`;
    return null;
}
const MAP_EXTS = new Set([".ts", ".js", ".py", ".md", ".json", ".sh"]);
const MAP_SKIP_DIRS = new Set([
    "node_modules",
    "dist",
    ".git",
    ".harness",
    "coverage",
]);
export function mapSymbols(text) {
    const out = [];
    const push = (s) => {
        if (s && out.length < 12 && !out.includes(s))
            out.push(s);
    };
    for (const line of text.split("\n")) {
        let m;
        if ((m = /^\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(line))) {
            push(m[1] + "()");
        }
        else if ((m =
            /^\s*export\s+(?:const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_]+)/.exec(line))) {
            push(m[1]);
        }
        else if (/^\s*export\s+default\b/.test(line)) {
            push("default");
        }
        else if ((m = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)/.exec(line))) {
            push(m[1] + "()");
        }
        else if ((m = /^class\s+([A-Za-z0-9_]+)/.exec(line))) {
            push(m[1]);
        }
        else if ((m = /^# (.+)/.exec(line)) && out.length === 0) {
            push(m[1].slice(0, 60));
        }
    }
    return out;
}
function buildMap(cwd) {
    const rows = [];
    const walk = (dir) => {
        let entries = [];
        try {
            entries = fs.readdirSync(dir).sort();
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (e.startsWith("."))
                continue;
            const abs = path.join(dir, e);
            let st = null;
            try {
                st = fs.statSync(abs);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                if (MAP_SKIP_DIRS.has(e))
                    continue;
                walk(abs);
            }
            else if (MAP_EXTS.has(path.extname(e)) && st.size <= 200000) {
                const text = readText(abs);
                if (text !== null)
                    rows.push({ rel: path.relative(cwd, abs), syms: mapSymbols(text) });
            }
        }
    };
    walk(cwd);
    const dirs = new Map();
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
        ...rows.map((r) => `- ${r.rel}${r.syms.length > 0 ? ": " + r.syms.join(", ") : ""}`),
        "",
    ];
    const text = out.join("\n");
    return {
        lines: out.length,
        files: rows.length,
        tokens: estTokens(text),
        text,
    };
}
function cmdMap() {
    const cwd = process.cwd();
    const r = buildMap(cwd);
    try {
        fs.mkdirSync(path.join(cwd, ".harness"), { recursive: true });
        fs.writeFileSync(path.join(cwd, ".harness", "MAP.md"), r.text);
    }
    catch {
        console.log("[harness] FAIL - map: could not write .harness/MAP.md");
        return false;
    }
    console.log(`[harness] ok - map: ${r.files} files, ${r.lines} lines, ~${fmtTok(r.tokens)} tokens -> .harness/MAP.md`);
    return true;
}
const OPTIMIZATIONS = [
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
function defaultOptimizations() {
    const out = {};
    for (const o of OPTIMIZATIONS)
        out[o.name] = true;
    return out;
}
// manifest toggles merged over defaults (unknown names ignored).
function readOptimizations(cwd) {
    const out = defaultOptimizations();
    try {
        const text = readText(path.join(cwd, ".harness", "config.json"));
        if (text === null)
            return out;
        const saved = JSON.parse(text).optimizations ?? {};
        for (const o of OPTIMIZATIONS) {
            if (typeof saved[o.name] === "boolean")
                out[o.name] = saved[o.name];
        }
    }
    catch {
        // corrupt manifest: defaults stand
    }
    return out;
}
function writeOptimizations(cwd, patch) {
    const manFile = path.join(cwd, ".harness", "config.json");
    let man = {
        version: VERSION,
        harness: [],
        files: [],
    };
    const manText = readText(manFile);
    if (manText !== null) {
        try {
            man = JSON.parse(manText);
        }
        catch {
            console.log("[harness] FAIL - .harness/config.json corrupt");
            return false;
        }
    }
    const merged = {
        ...defaultOptimizations(),
        ...(man.optimizations ?? {}),
        ...patch,
    };
    const clean = {};
    for (const o of OPTIMIZATIONS)
        clean[o.name] = merged[o.name] !== false;
    man.optimizations = clean;
    try {
        fs.mkdirSync(path.dirname(manFile), { recursive: true });
        fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
    }
    catch {
        console.log("[harness] FAIL - could not write .harness/config.json");
        return false;
    }
    return true;
}
function readDisabledByPerf(cwd) {
    try {
        const text = readText(path.join(cwd, ".harness", "config.json"));
        if (text === null)
            return new Set();
        const list = JSON.parse(text).disabledByPerf ?? [];
        return new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
    }
    catch {
        return new Set();
    }
}
// pure: which hooks exceed budget. unit-tested.
export function slowHooks(measurements, budgetMs) {
    return Object.entries(measurements)
        .filter(([, ms]) => ms > budgetMs)
        .map(([name]) => name)
        .sort();
}
function cmdOptimizations(args) {
    const cwd = process.cwd();
    const sub = args[0] ?? "";
    if (sub === "" || sub === "list") {
        const opts = readOptimizations(cwd);
        console.log("[harness] optimizations (all on by default):");
        for (const o of OPTIMIZATIONS) {
            console.log(`  ${o.name} [${o.scope}] ${opts[o.name] ? "on" : "off"} - ${o.desc}`);
        }
        return true;
    }
    if (sub !== "enable" && sub !== "disable") {
        console.log("[harness] optimizations - want [enable|disable] <name|all>");
        return false;
    }
    const target = args[1] ?? "";
    const names = target === "all"
        ? OPTIMIZATIONS.map((o) => o.name)
        : OPTIMIZATIONS.map((o) => o.name).filter((n) => n === target);
    if (names.length === 0) {
        console.log(`[harness] optimizations - unknown name "${target}" (try: ${OPTIMIZATIONS.map((o) => o.name).join(", ")})`);
        return false;
    }
    const patch = {};
    for (const n of names)
        patch[n] = sub === "enable";
    if (!writeOptimizations(cwd, patch))
        return false;
    console.log(`[harness] ok - optimizations ${sub}d: ${names.join(", ")}`);
    return true;
}
async function runCommand(cmd, flags) {
    const all = [cmd, ...flags];
    if (all.includes("-h") ||
        all.includes("--help") ||
        cmd === "help" ||
        cmd === "-h" ||
        cmd === "--help") {
        help();
        return true;
    }
    if (all.includes("-v") ||
        all.includes("--version") ||
        cmd === "version" ||
        cmd === "-v" ||
        cmd === "--version") {
        console.log(`harness ${VERSION}`);
        return true;
    }
    switch (cmd) {
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
            if (flags[0] === "add") {
                const raw = flags[1] ?? "";
                if (!/^[a-z0-9-]+$/.test(raw)) {
                    console.log("[harness] adapter add - want a lowercase-hyphen name");
                    return false;
                }
                const dir = path.join(process.cwd(), ".harness", "adapters", raw);
                if (fs.existsSync(dir)) {
                    console.log(`[harness] adapter add - ${dir} exists already`);
                    return false;
                }
                const adapterJson = JSON.stringify({
                    name: raw,
                    displayName: raw,
                    skillPath: "",
                    hookPath: "",
                    memoryPath: "MEMORY.md",
                    agentsPath: "AGENTS.md",
                    transpile: "./transpile.sh",
                    notes: `Fill in skillPath, then run: harness init --harness ${raw}`,
                }, null, 2) + "\n";
                const wrapper = `#!/usr/bin/env bash\n# install this adapter's files into the current project.\n# delegates to harness init so there is one real implementation.\nset -euo pipefail\nif ! command -v harness >/dev/null 2>&1; then\n  echo "[${raw}] harness not found - install it first" >&2\n  exit 1\nfi\nexec harness init --harness ${raw} --migrate\n`;
                try {
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, "adapter.json"), adapterJson);
                    fs.writeFileSync(path.join(dir, "transpile.sh"), wrapper);
                    fs.chmodSync(path.join(dir, "transpile.sh"), 0o755);
                }
                catch {
                    console.log(`[harness] adapter add - could not scaffold ${raw}`);
                    return false;
                }
                console.log(`[harness] ok - adapter ${raw} scaffolded (fill in skillPath, then: harness init --harness ${raw})`);
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
                    console.log(`  ${a.name}${a.json?.displayName ? ` - ${a.json.displayName}` : ""}${a.error ? ` (${a.error})` : ""}`);
                }
                for (const a of listAdapters(process.cwd(), path.join(".harness", "adapters"))) {
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
                    console.log(`[harness] skill remove - no added skill named "${flags[1]}" (built-ins live in the install, not here)`);
                    return false;
                }
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
                catch {
                    console.log(`[harness] skill remove - could not remove ${name}`);
                    return false;
                }
                const manFile = path.join(process.cwd(), ".harness", "config.json");
                const manText = readText(manFile);
                if (manText !== null) {
                    try {
                        const man = JSON.parse(manText);
                        man.addedSkills = (man.addedSkills ?? []).filter((a) => a.name !== name);
                        fs.writeFileSync(manFile, JSON.stringify(man, null, 2));
                    }
                    catch {
                        console.log("[harness] skill remove - manifest left stale, edit it by hand");
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
                    console.log(`[harness] skill verify - no added skill named "${flags[1]}"`);
                    return false;
                }
                if (list.length === 0) {
                    console.log("[harness] skill verify - no added skills (add one with: harness skill add owner/repo)");
                    return true;
                }
                const bad = list
                    .map((a) => verifyAddedSkill(process.cwd(), a))
                    .filter((x) => Boolean(x));
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
                    console.log(`  ${s.name} - ${s.desc || "(no description)"} (~${fmtTok(s.tokens)})`);
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
                    return (s.name.includes(q) ||
                        s.desc.toLowerCase().includes(q) ||
                        body.includes(q));
                });
                if (hits.length === 0) {
                    console.log(`[harness] skill search - no skills match "${q}"`);
                }
                for (const s of hits) {
                    console.log(`  ${s.name} - ${s.desc || "(no description)"}`);
                }
                return true;
            }
            if (flags[0] === "info") {
                const s = skills.find((x) => x.name === flags[1]);
                if (!s) {
                    console.log("[harness] skill info - unknown skill (try: harness skill list)");
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
                    console.log("[harness] memory - no MEMORY.md here (run harness init)");
                }
                else {
                    console.log(text);
                }
                return true;
            }
            if (flags[0] === "prune") {
                return cmdOptimize();
            }
            if (flags[0] === "sync") {
                const note = flags.slice(1).join(" ").trim();
                if (!note) {
                    console.log("[harness] memory sync - give a note to append");
                    return false;
                }
                return cmdMemorySync(note);
            }
            if (flags[0] === "edit") {
                const memFile = path.join(process.cwd(), "MEMORY.md");
                if (!fs.existsSync(memFile)) {
                    console.log("[harness] memory - no MEMORY.md here (run harness init)");
                    return false;
                }
                if (!process.stdin.isTTY || !process.stdout.isTTY) {
                    console.log(`[harness] memory - no terminal, edit ${memFile} by hand`);
                    return false;
                }
                const editor = (process.env.EDITOR || process.env.VISUAL || "vi").split(" ")[0];
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
                    console.log(`  ${h} ${isExec(path.join(root, h)) ? "exec" : "noexec"}`);
                }
                return true;
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
                let done = 0;
                for (const h of matched) {
                    try {
                        fs.chmodSync(path.join(root, h), flags[0] === "enable" ? 0o755 : 0o644);
                        done += 1;
                    }
                    catch {
                        // keep going
                    }
                }
                console.log(`[harness] ok - instinct ${flags[0]}d ${done}/${matched.length}`);
                return done === matched.length;
            }
            console.log(`[harness] instinct ${flags.join(" ")} - not implemented yet`);
            return true;
        }
        case "research": {
            if (flags.length === 0) {
                let files = [];
                try {
                    files = fs
                        .readdirSync(path.join(process.cwd(), "research", "findings"))
                        .filter((f) => f.endsWith(".md"))
                        .sort();
                }
                catch {
                    files = [];
                }
                if (files.length === 0) {
                    console.log('[harness] research - no findings yet (capture one: harness research "query")');
                    return true;
                }
                for (const f of files) {
                    const text = readText(path.join(process.cwd(), "research", "findings", f));
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
                fs.writeFileSync(abs, `# Findings: ${query}\n\nDate: ${stamp}\nStatus: draft\nSources:\n\n- \n\n## Verdict\n\n\n`);
            }
            catch {
                console.log("[harness] FAIL - research: could not write finding");
                return false;
            }
            console.log(`[harness] ok - research stub: ${rel} (fill it in, then plan)`);
            return true;
        }
        case "security": {
            const root = selfRoot();
            if (!root) {
                console.log("[harness] security - cannot locate install");
                return false;
            }
            const sub = flags[0] ?? "audit";
            if (sub !== "audit" && sub !== "scan") {
                console.log(`[harness] security ${flags.join(" ")} - not implemented yet`);
                return true;
            }
            const abs = path.join(root, "security", "audit.sh");
            if (!fs.existsSync(abs)) {
                console.log("[harness] security - audit.sh missing from install");
                return false;
            }
            const rest = flags.slice(1);
            const args = sub === "scan" && !rest.includes("--staged")
                ? ["--staged", ...rest]
                : rest;
            const r = spawnSync("bash", [abs, ...args], {
                stdio: "inherit",
                cwd: process.cwd(),
            });
            return r.status === 0;
        }
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
// only auto-run as a CLI, never on import (vitest imports this module).
// argv[1] can be a bin symlink, so compare realpaths, not strings.
const invokedAsCli = (() => {
    try {
        const a1 = process.argv[1];
        if (typeof a1 !== "string" || a1 === "")
            return false;
        if (/(^|[\\/])cli\.(ts|js)$/.test(a1))
            return true;
        return (fs.realpathSync(a1) === fs.realpathSync(fileURLToPath(import.meta.url)));
    }
    catch {
        return false;
    }
})();
if (invokedAsCli) {
    main().catch((e) => {
        console.error("[harness] error:", e);
        process.exit(1);
    });
}
