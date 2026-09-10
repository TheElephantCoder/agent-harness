#!/usr/bin/env node
// harness cli - small shim, real logic lives in the scripts and hooks
// node >=20
import * as readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
export const VERSION = "0.1.2";
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
    "optimize",
    "adapter",
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
    return [rule, "", art, "", title, "", sub, credit, ""].join("\n") + "\n" + divider;
}
function help() {
    console.log(`
harness v${VERSION} - agent harness perf layer by TheElephantCoder

usage: harness <command> [options]

  init [--harness <name>] [--auto] [--migrate]   install into current project
  doctor [--fix] [--strict]                      verify install and project
  bench [--compare] [--quick]                    measure costs, save baseline
  optimize                                       prune memory, repair, report savings
  skill list                                     list skills with cost
  memory <show|prune>                            show or prune MEMORY.md
  instinct list                                  list hooks
  adapter list                                   list supported harnesses
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
async function showMenu() {
    const options = [
        "Set up this project",
        "Check setup",
        "Run benchmark",
        "Skip straight to the prompt",
    ];
    const picked = await selectOption("What do you want to do?", options);
    if (picked === 0) {
        await runCommand("init", ["--auto"]);
    }
    else if (picked === 1) {
        await runCommand("doctor", []);
    }
    else if (picked === 2) {
        await runCommand("bench", []);
    }
    console.log(paint(ANSI.dim, "╌".repeat(termWidth())));
}
async function interactive() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${paint(ANSI.bold + ANSI.cyan, "harness>")} `,
        completer: (line) => {
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
    return !!process.stdout.isTTY && process.env.TERM !== "dumb";
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
async function animatedNpmUpgrade(url, tag) {
    let frame = 0;
    let pct = 4;
    let stage = "resolving main";
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
        const sha = await resolveMainSha();
        const pinned = sha
            ? `https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/${sha}`
            : url;
        stage = `reinstalling ${sha ? sha.slice(0, 7) : tag}`;
        pct = Math.max(pct, 18);
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
        const sha = useUpgradeBar() ? null : await resolveMainSha();
        const url = sha
            ? `https://codeload.github.com/TheElephantCoder/agent-harness/tar.gz/${sha}`
            : UPGRADE_TARBALL;
        if (useUpgradeBar()) {
            const result = await animatedNpmUpgrade(UPGRADE_TARBALL, "latest");
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
    if (root && root.includes([path.sep + "Cellar", "agent-harness"].join(path.sep))) {
        console.log("[harness] brew install detected - run: brew upgrade agent-harness");
        return true;
    }
    if (root && root.includes([path.sep + "usr", "lib", "agent-harness"].join(path.sep))) {
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
function estTokens(text) {
    return Math.ceil(text.length / 4);
}
function fmtTok(t) {
    return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`;
}
function parseFrontmatter(text) {
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
function listAdapters(root) {
    let entries = [];
    try {
        entries = fs.readdirSync(path.join(root, "adapters")).sort();
    }
    catch {
        return [];
    }
    const out = [];
    for (const e of entries) {
        const d = path.join(root, "adapters", e);
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
    codex: ".codex",
    "kiro-cli": ".kiro",
    "kiro-desktop": ".kiro",
    aider: ".aider.conf.yml",
    cline: ".clinerules",
    generic: "",
};
function cmdInit(flags) {
    const root = selfRoot();
    if (!root) {
        console.log("[harness] init - cannot locate install");
        return false;
    }
    const migrate = flags.includes("--migrate");
    const hi = flags.indexOf("--harness");
    const explicit = hi !== -1
        ? (flags[hi + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        : [];
    const adapters = listAdapters(root).filter((a) => a.json);
    const byName = new Map(adapters.map((a) => [a.name, a]));
    let names;
    if (explicit.length > 0) {
        const unknown = explicit.filter((n) => !byName.has(n));
        if (unknown.length > 0) {
            console.log(`[harness] init - unknown harness: ${unknown.join(", ")} (try: harness adapter list)`);
            return false;
        }
        names = explicit;
    }
    else {
        names = adapters
            .map((a) => a.name)
            .filter((n) => {
            const m = AUTO_MARKERS[n] ?? "";
            return m !== "" && fs.existsSync(path.join(process.cwd(), m));
        });
    }
    const cwd = process.cwd();
    const manFile = path.join(cwd, ".harness", "config.json");
    const prior = readText(manFile);
    if (prior !== null && !migrate) {
        console.log("[harness] init - already initialized here (use --migrate to fill gaps)");
        return false;
    }
    const tracked = new Set();
    if (prior !== null) {
        try {
            for (const f of JSON.parse(prior).files ?? [])
                tracked.add(f);
        }
        catch {
            // corrupt manifest: rewrite below
        }
    }
    const written = [];
    const skipped = [];
    const put = (rel, content, exec = false) => {
        const abs = path.join(cwd, rel);
        if (fs.existsSync(abs)) {
            skipped.push(rel);
            return;
        }
        try {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
            if (exec)
                fs.chmodSync(abs, 0o755);
            written.push(rel);
        }
        catch {
            console.log(`[harness] init - could not write ${rel}`);
        }
    };
    const agentsSrc = readText(path.join(root, "AGENTS.md"));
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
    for (const n of names) {
        const sp = byName.get(n).json.skillPath;
        if (sp.endsWith(".md")) {
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
    const copied = [];
    const copyHook = (rel) => {
        const text = readText(path.join(root, rel));
        if (text === null)
            return;
        const base = `${path.basename(path.dirname(rel))}--${path.basename(rel)}`;
        put(`.harness/hooks/${base}`, text, true);
        copied.push(base);
    };
    for (const h of listHooks(root))
        copyHook(h);
    copyHook("security/audit.sh");
    if (names.includes("claude")) {
        const rel = ".claude/settings.json";
        if (!tracked.has(rel) && !fs.existsSync(path.join(cwd, rel))) {
            const entry = (base, matcher, timeout) => ({
                matcher,
                hooks: [{ type: "command", command: `./.harness/hooks/${base}`, timeout }],
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
    const files = [...tracked, ...written];
    try {
        fs.mkdirSync(path.dirname(manFile), { recursive: true });
        fs.writeFileSync(manFile, JSON.stringify({ version: VERSION, harness: names, files, ts: new Date().toISOString() }, null, 2));
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
    /BEGIN PRIVATE KEY/,
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
    const noexec = hooks.filter((h) => !isExec(path.join(root, h)));
    if (noexec.length > 0) {
        if (fix) {
            let repaired = 0;
            for (const h of noexec) {
                try {
                    fs.chmodSync(path.join(root, h), 0o755);
                    if (isExec(path.join(root, h)))
                        repaired += 1;
                }
                catch {
                    // keep going
                }
            }
            const still = hooks.filter((h) => !isExec(path.join(root, h)));
            if (still.length === 0) {
                console.log(`[harness] ok - hooks: repaired exec on ${repaired}, ${hooks.length} executable`);
            }
            else {
                fail(`[harness] FAIL - hooks not executable: ${still.join(", ")}`);
            }
        }
        else {
            fail(`[harness] FAIL - hooks not executable (run --fix): ${noexec.join(", ")}`);
        }
    }
    else if (hooks.length === 0) {
        fail("[harness] FAIL - hooks: none found");
    }
    else {
        console.log(`[harness] ok - hooks: ${hooks.length} executable`);
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
    const manText = readText(path.join(process.cwd(), ".harness", "config.json"));
    if (manText !== null) {
        try {
            const files = JSON.parse(manText).files ?? [];
            const missing = files.filter((f) => !fs.existsSync(path.join(process.cwd(), f)));
            if (missing.length > 0) {
                fail(`[harness] FAIL - project init files missing: ${missing.join(", ")}`);
            }
            else {
                console.log(`[harness] ok - project: ${files.length}/${files.length} init files present`);
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
function pruneFile(abs, budget) {
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
    const mem = ["MEMORY.md", path.join(".kiro", "MEMORY.md")]
        .map((f) => path.join(cwd, f))
        .find((f) => fs.existsSync(f));
    if (!mem) {
        console.log("[harness] optimize - no MEMORY.md here (run harness init)");
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
    const skills = listSkills(root);
    const total = skills.reduce((a, s) => a + s.tokens, 0);
    const top = [...skills].sort((a, b) => b.tokens - a.tokens)[0];
    console.log(`[harness] ok - skills ${skills.length} files ~${fmtTok(total)} total${top ? `, largest ${top.name} ~${fmtTok(top.tokens)}` : ""}`);
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
        case "bench": {
            return cmdBench(flags);
        }
        case "optimize": {
            return cmdOptimize();
        }
        case "adapter": {
            if (flags[0] === "list" || flags.length === 0) {
                const root = selfRoot();
                if (!root) {
                    console.log("[harness] adapter - cannot locate install");
                    return false;
                }
                for (const a of listAdapters(root)) {
                    console.log(`  ${a.name}${a.json?.displayName ? ` - ${a.json.displayName}` : ""}${a.error ? ` (${a.error})` : ""}`);
                }
                return true;
            }
            console.log(`[harness] adapter ${flags.join(" ")} - not implemented yet`);
            return true;
        }
        case "skill": {
            if (flags[0] === "list") {
                const root = selfRoot();
                if (!root) {
                    console.log("[harness] skill - cannot locate install");
                    return false;
                }
                for (const s of listSkills(root)) {
                    console.log(`  ${s.name} - ${s.desc || "(no description)"} (~${fmtTok(s.tokens)})`);
                }
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
            console.log(`[harness] memory ${flags.join(" ")} - not implemented yet`);
            return true;
        }
        case "instinct": {
            if (flags[0] === "list") {
                const root = selfRoot();
                if (!root) {
                    console.log("[harness] instinct - cannot locate install");
                    return false;
                }
                for (const h of listHooks(root)) {
                    console.log(`  ${h} ${isExec(path.join(root, h)) ? "exec" : "noexec"}`);
                }
                return true;
            }
            console.log(`[harness] instinct ${flags.join(" ")} - not implemented yet`);
            return true;
        }
        case "research":
        case "security":
            console.log(`[harness] ${cmd} ${flags.join(" ")} - not implemented yet`);
            return true;
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
