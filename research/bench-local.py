#!/usr/bin/env python3
"""Portable local-model session A/B: bare read-everything vs harness
(MAP + memory) on a scripted multi-file search task. Measures per-task
CPU/wall/tokens on any Ollama host. No repo checkout needed beyond this file.

Usage (on the machine under test):
  pip install --no-deps <nothing>   # stdlib only
  ollama pull qwen2.5-coder:1.5b
  python3 research/bench-local.py --models qwen2.5-coder:1.5b --reps 2
  python3 research/bench-local.py --dry-run   # no ollama needed: prints
                                              # contexts + token estimates

Method: file reads are tools (free); only reasoning steps cost inference.
BARE (4 inferences): orient -> batch1 (6 files) -> batch2 (6 files) -> fix.
HARNESS (2 inferences): orient (listing + MAP + MEMORY) -> fix (history +
retry.ts + the 2 caller files). Same task, same seed, alternating order.
Evidence: JSONL rows, one per turn, with durations straight from Ollama.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request

TASK = ("The retry helper swallows errors. Name every module that calls "
        "retry, then show the fixed retry function that rethrows the last "
        "error after exhausting attempts.")
FILES6A = ["strutil.ts", "mathutil.ts", "arrayutil.ts", "dateutil.ts",
           "retry.ts", "cache.ts"]
FILES6B = ["log.ts", "config.ts", "validate.ts", "format.ts", "net.ts",
           "main.ts"]
CALLERS = ["retry.ts", "cache.ts", "main.ts"]
SRCS = {
"strutil.ts": "export function cap(s: string): string {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\nexport function slug(s: string): string {\n  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');\n}\n",
"mathutil.ts": "export function clamp(n: number, lo: number, hi: number): number {\n  return Math.min(hi, Math.max(lo, n));\n}\nexport function sum(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\n",
"arrayutil.ts": "export function chunk<T>(xs: T[], n: number): T[][] {\n  const out: T[][] = [];\n  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));\n  return out;\n}\n",
"dateutil.ts": "export function today(): string {\n  return new Date().toISOString().slice(0, 10);\n}\n",
"retry.ts": "export async function retry<T>(fn: () => Promise<T>, times: number): Promise<T | undefined> {\n  let last: unknown = undefined;\n  for (let i = 0; i < times; i++) {\n    try {\n      return await fn();\n    } catch (e) {\n      last = e;\n    }\n  }\n  return undefined;\n}\n",
"cache.ts": "import { retry } from './retry';\nconst store = new Map<string, string>();\nexport async function fetchCached(key: string, loader: () => Promise<string>): Promise<string | undefined> {\n  if (store.has(key)) return store.get(key);\n  const v = await retry(loader, 3);\n  if (v !== undefined) store.set(key, v);\n  return v;\n}\n",
"log.ts": "export type Level = 'debug' | 'info' | 'warn' | 'error';\nexport function log(l: Level, msg: string): void {\n  console.log(`[${l}] ${msg}`);\n}\n",
"config.ts": "import * as fs from 'node:fs';\nexport function loadConfig(p: string): Record<string, string> {\n  try {\n    return JSON.parse(fs.readFileSync(p, 'utf8'));\n  } catch {\n    return {};\n  }\n}\n",
"validate.ts": "export function isId(s: string): boolean {\n  return /^[a-z0-9-]{1,32}$/.test(s);\n}\n",
"format.ts": "export function pad(s: string, n: number): string {\n  return s.length >= n ? s : s + ' '.repeat(n - s.length);\n}\n",
"net.ts": "export async function get(url: string): Promise<string> {\n  const r = await fetch(url);\n  if (!r.ok) throw new Error(`http ${r.status}`);\n  return r.text();\n}\n",
"main.ts": "import { retry } from './retry';\nimport { log } from './log';\nexport async function startup(urls: string[]): Promise<void> {\n  for (const u of urls) {\n    const body = await retry(() => import('./net').then((m) => m.get(u)), 3);\n    log('info', `${u}: ${(body ?? '').length}`);\n  }\n}\n",
"MEMORY.md": "# Memory: minibed utils. Twelve tiny TS modules, no deps. retry.ts wraps flaky async ops. Known retry callers: cache.ts and main.ts.\n",
"MAP.md": "# MAP.md\n- strutil.ts: cap(), slug()\n- mathutil.ts: clamp(), sum()\n- arrayutil.ts: chunk()\n- dateutil.ts: today()\n- retry.ts: retry() async attempts\n- cache.ts: fetchCached() via retry\n- log.ts: log()\n- config.ts: loadConfig()\n- validate.ts: isId()\n- format.ts: pad()\n- net.ts: get() throws on bad status\n- main.ts: startup() via retry\n",
}


def est_tokens(text):
    return (len(text) + 3) // 4


def build_turns(arm):
    listing = "Files: " + ", ".join(sorted(SRCS))
    listing = listing.replace(", MAP.md", "").replace(", MEMORY.md", "")
    if arm == "bare":
        return [
            TASK + "\n\n" + listing + "\n\nPlan which files to read first.",
            "Batch 1:\n" + "\n".join(f"{f}:\n{SRCS[f]}" for f in FILES6A),
            "Batch 2:\n" + "\n".join(f"{f}:\n{SRCS[f]}" for f in FILES6B),
            "Now " + TASK,
        ]
    return [
        TASK + "\n\n" + listing + "\n\nMAP.md:\n" + SRCS["MAP.md"]
        + "\n\nMEMORY.md:\n" + SRCS["MEMORY.md"],
        "Now " + TASK + "\n\n" + "\n".join(f"{f}:\n{SRCS[f]}" for f in CALLERS),
    ]


def target_pids():
    r = subprocess.run(["pgrep", "-f", "Resources/(ollama serve|llama-server)"],
                       capture_output=True, text=True)
    return [int(p) for p in r.stdout.split() if p.strip()]


def rss_total(pids):
    total = 0
    for pid in pids:
        try:
            r = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)],
                               capture_output=True, text=True)
            total += int(r.stdout.strip())
        except Exception:
            pass
    return total


def cputime_total(pids):
    total = 0.0
    for pid in pids:
        try:
            r = subprocess.run(["ps", "-o", "cputime=", "-p", str(pid)],
                               capture_output=True, text=True)
            m = re.match(r"(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)",
                         r.stdout.strip())
            d, h, mi, s = (float(m.group(i) or 0) for i in (1, 2, 3, 4))
            total += ((d * 24 + h) * 60 + mi) * 60 + s
        except Exception:
            pass
    return total


def log(out_fh, row):
    out_fh.write(json.dumps(row) + "\n")
    out_fh.flush()


def generate(host, model, prompt, seed):
    pids = target_pids()
    body = json.dumps({"model": model, "prompt": prompt, "stream": False,
                       "options": {"num_ctx": 4096, "num_predict": 150,
                                   "temperature": 0, "seed": seed}}).encode()
    req = urllib.request.Request(host + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    peak = [rss_total(pids)]
    stop = False

    def poll():
        while not stop:
            try:
                peak.append(rss_total(target_pids()))
            except Exception:
                pass
            time.sleep(0.25)

    th = threading.Thread(target=poll, daemon=True)
    cpu0 = cputime_total(pids)
    t0 = time.perf_counter()
    th.start()
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            resp = json.load(res)
    finally:
        stop = True
    wall = time.perf_counter() - t0
    th.join(timeout=2)
    return resp, wall, max(peak), cputime_total(target_pids()) - cpu0


def main():
    ap = argparse.ArgumentParser(description="Local-model session A/B")
    ap.add_argument("--models", default="qwen2.5-coder:1.5b")
    ap.add_argument("--reps", type=int, default=2)
    ap.add_argument("--seed", type=int, default=500)
    ap.add_argument("--host", default="http://localhost:11434")
    ap.add_argument("--out", default="bench-local.jsonl")
    ap.add_argument("--dry-run", action="store_true",
                    help="print contexts + estimates, no ollama needed")
    args = ap.parse_args()

    if args.dry_run:
        for arm in ["bare", "harness"]:
            turns = build_turns(arm)
            total = sum(est_tokens(t) for t in turns)
            print(f"{arm}: {len(turns)} turn-prompts, est ~{total} tokens "
                  f"(history accumulates on top live)")
            assert total < 4000, "context exceeds num_ctx headroom"
        print("dry-run ok")
        return 0

    out_fh = open(args.out, "a", encoding="utf-8")
    for model in args.models.split(","):
        print("== warmup", model, flush=True)
        generate(args.host, model.strip(), "Reply with the word ok.", 1)
        for rep in range(args.reps):
            seed = args.seed + rep
            order = ["bare", "harness"] if rep % 2 == 0 else ["harness", "bare"]
            for arm in order:
                hist = []
                for turn, prompt in enumerate(build_turns(arm)):
                    full = "\n\n".join(hist + [prompt])
                    print(f"{model} {arm} rep{rep} turn{turn} chars={len(full)}",
                          flush=True)
                    resp, wall, peak, cpu = generate(args.host, model.strip(),
                                                     full, seed)
                    out = resp.get("response", "")
                    done = turn == (3 if arm == "bare" else 1)
                    log(out_fh, {"model": model, "arm": arm, "rep": rep,
                                 "turn": turn, "prompt_chars": len(full),
                                 "prompt_eval_count": resp.get("prompt_eval_count"),
                                 "prompt_eval_s": (resp.get("prompt_eval_duration") or 0) / 1e9,
                                 "eval_count": resp.get("eval_count"),
                                 "eval_s": (resp.get("eval_duration") or 0) / 1e9,
                                 "wall_s": round(wall, 2), "rss_peak_kb": peak,
                                 "cpu_s": round(cpu, 2),
                                 "complete": (("throw" in out) if done else None),
                                 "response": out})
                    hist += [prompt, out]
    out_fh.close()
    print("done ->", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
