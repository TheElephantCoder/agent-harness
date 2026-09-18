// Generates the megabox benchmark bed: a mid-size TS monorepo with a real
// order-pricing flow, deterministic data (seeded), and a passing suite.
// Run: node gen-megabox.mjs <dest>
import * as fs from "node:fs";
import * as path from "node:path";

const dest = process.argv[2];
if (!dest) {
  console.error("usage: node gen-megabox.mjs <dest>");
  process.exit(1);
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const W = (rel, content) => {
  const f = path.join(dest, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};

const ADJ = ["Pro", "Max", "Lite", "Ultra", "Prime", "Eco", "Turbo", "Nano", "Mega", "Smart"];
const NOUN = ["Widget", "Gadget", "Sprocket", "Cog", "Bolt", "Panel", "Valve", "Gear", "Latch", "Probe", "Sensor", "Relay"];

W("package.json", `{
  "name": "megabox",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": { "tsx": "^4.0.0", "typescript": "^5.5.0", "vitest": "^1.0.0" }
}
`);
W("tsconfig.json", `{
  "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "skipLibCheck": true },
  "include": ["shared/**/*", "core/**/*", "shop/**/*", "api/**/*", "web/**/*", "scripts/**/*", "test/**/*"]
}
`);
W(".gitignore", "node_modules/\ndist/\n");
W("README.md", "# megabox\n\nDemo store monorepo for agent benchmark tasks.\n\nPackages: `shared`, `core`, `shop`, `api`, `web`. Run tests with `npm test`.\n");

// ---------- shared ----------
W("shared/src/money.ts", `export function formatMoney(cents: number, currency = "USD"): string {
  const sym: Record<string, string> = { USD: "$", EUR: "\\u20AC", GBP: "\\u00A3" };
  return \`\${sym[currency] ?? "$"}\${(cents / 100).toFixed(2)}\`;
}
export function parseMoney(s: string): number {
  const m = /^\\$?([0-9]+)\\.([0-9]{2})$/.exec(s.trim());
  if (!m) throw new Error("bad money: " + s);
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}
export function addCents(a: number, b: number): number {
  return a + b;
}
export function pctOff(cents: number, pct: number): number {
  return Math.round((cents * (100 - pct)) / 100);
}
`);
W("shared/src/result.ts", `export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
export function err<E = string>(error: E): Result<never, E> {
  return { ok: false, error };
}
export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}
export function unwrap<T>(r: Result<T>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
`);
W("shared/src/ids.ts", `let n = 0;
export function resetIds(): void {
  n = 0;
}
export function newId(prefix = "id"): string {
  n += 1;
  return \`\${prefix}-\${n}\`;
}
`);
W("shared/src/types.ts", `export type Region = "XA" | "XB" | "XC";
export interface Sku {
  code: string;
  name: string;
  priceCents: number;
}
`);
W("shared/src/constants.ts", `import type { Region } from "./types.js";
export const TAX_RATES: Record<Region, number> = { XA: 8, XB: 0, XC: 5 };
export const FREE_SHIP_CENTS = 10000;
export const FLAT_SHIP_CENTS = 900;
`);
W("shared/src/geo.ts", `import type { Region } from "./types.js";
export function regionName(r: Region): string {
  return { XA: "Alpha", XB: "Beta", XC: "Gamma" }[r];
}
export function isTaxFree(r: Region): boolean {
  return r === "XB";
}
`);
W("shared/src/currency.ts", `export function symbolFor(code: string): string {
  const sym: Record<string, string> = { USD: "$", EUR: "\\u20AC", GBP: "\\u00A3", JPY: "\\u00A5" };
  return sym[code] ?? "$";
}
export function decimalsFor(code: string): number {
  return code === "JPY" ? 0 : 2;
}
`);
W("shared/src/units.ts", `export function kgToG(kg: number): number {
  return Math.round(kg * 1000);
}
export function cmToMm(cm: number): number {
  return Math.round(cm * 10);
}
`);
W("shared/test/money.test.ts", `import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, pctOff } from "../src/money.js";
describe("money", () => {
  it("formats and parses", () => {
    expect(formatMoney(1000)).toBe("$10.00");
    expect(parseMoney("$10.00")).toBe(1000);
    expect(pctOff(1000, 10)).toBe(900);
  });
});
`);
W("shared/test/result.test.ts", `import { describe, expect, it } from "vitest";
import { err, isOk, ok, unwrap } from "../src/result.js";
describe("result", () => {
  it("wraps values", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err("x"))).toBe(false);
    expect(unwrap(err("x"), 7)).toBe(7);
  });
});
`);
W("shared/test/ids.test.ts", `import { describe, expect, it } from "vitest";
import { newId, resetIds } from "../src/ids.js";
describe("ids", () => {
  it("counts up", () => {
    resetIds();
    expect(newId("o")).toBe("o-1");
    expect(newId("o")).toBe("o-2");
  });
});
`);

// ---------- core ----------
const coreMods = {
  config: [
    `export interface AppConfig { env: string; port: number; logLevel: string; }
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  return {
    env: env.NODE_ENV ?? "development",
    port: parseInt(env.PORT ?? "3000", 10),
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
`,
    `import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
describe("config", () => {
  it("fills defaults", () => {
    expect(loadConfig({})).toEqual({ env: "development", port: 3000, logLevel: "info" });
  });
});
`,
  ],
  logger: [
    `const ORDER = ["debug", "info", "warn", "error"];
export interface Logger { debug(m: string): void; info(m: string): void; warn(m: string): void; error(m: string): void; }
export function createLogger(ns: string, level = "info", sink: (s: string) => void = () => {}): Logger {
  const enabled = (l: string) => ORDER.indexOf(l) >= ORDER.indexOf(level);
  const emit = (l: string) => (m: string) => {
    if (enabled(l)) sink(\`[\${l}] \${ns}: \${m}\`);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}
`,
    `import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
describe("logger", () => {
  it("filters below level", () => {
    const out: string[] = [];
    const l = createLogger("t", "warn", (s) => out.push(s));
    l.info("nope");
    l.error("yep");
    expect(out).toEqual(["[error] t: yep"]);
  });
});
`,
  ],
  errors: [
    `export class AppError extends Error {
  code: string;
  constructor(message: string, code = "APP_ERROR") {
    super(message);
    this.code = code;
  }
}
export class NotFoundError extends AppError {
  constructor(what: string) {
    super(\`not found: \${what}\`, "NOT_FOUND");
  }
}
export class ValidationError extends AppError {
  constructor(what: string) {
    super(\`invalid: \${what}\`, "VALIDATION");
  }
}
`,
    `import { describe, expect, it } from "vitest";
import { NotFoundError } from "../src/errors.js";
describe("errors", () => {
  it("carries codes", () => {
    expect(new NotFoundError("x").code).toBe("NOT_FOUND");
  });
});
`,
  ],
  validate: [
    `export function isSku(s: string): boolean {
  return /^[A-Z]{3}-\\d{3}$/.test(s);
}
export function isEmail(s: string): boolean {
  return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(s);
}
export function nonEmpty(s: string): boolean {
  return s.trim().length > 0;
}
`,
    `import { describe, expect, it } from "vitest";
import { isEmail, isSku } from "../src/validate.js";
describe("validate", () => {
  it("checks skus and emails", () => {
    expect(isSku("WDG-001")).toBe(true);
    expect(isSku("nope")).toBe(false);
    expect(isEmail("a@b.co")).toBe(true);
  });
});
`,
  ],
  cache: [
    `export class TtlMap<K, V> {
  private m = new Map<K, V>();
  set(k: K, v: V): void {
    this.m.set(k, v);
  }
  get(k: K): V | undefined {
    return this.m.get(k);
  }
  has(k: K): boolean {
    return this.m.has(k);
  }
  clear(): void {
    this.m.clear();
  }
  get size(): number {
    return this.m.size;
  }
}
`,
    `import { describe, expect, it } from "vitest";
import { TtlMap } from "../src/cache.js";
describe("cache", () => {
  it("stores and clears", () => {
    const c = new TtlMap<string, number>();
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    expect(c.has("b")).toBe(false);
    c.clear();
    expect(c.size).toBe(0);
  });
});
`,
  ],
  events: [
    `export type Handler = (payload: unknown) => void;
export class Emitter {
  private h = new Map<string, Handler[]>();
  on(event: string, fn: Handler): void {
    this.h.set(event, [...(this.h.get(event) ?? []), fn]);
  }
  emit(event: string, payload: unknown): number {
    const fns = this.h.get(event) ?? [];
    for (const f of fns) f(payload);
    return fns.length;
  }
}
`,
    `import { describe, expect, it } from "vitest";
import { Emitter } from "../src/events.js";
describe("events", () => {
  it("fans out", () => {
    const e = new Emitter();
    const got: unknown[] = [];
    e.on("x", (p) => got.push(p));
    expect(e.emit("x", 1)).toBe(1);
    expect(got).toEqual([1]);
  });
});
`,
  ],
  retry: [
    `export function withRetry<T>(fn: () => T, attempts: number): T {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
`,
    `import { describe, expect, it } from "vitest";
import { withRetry } from "../src/retry.js";
describe("retry", () => {
  it("retries then returns", () => {
    let n = 0;
    const v = withRetry(() => {
      n += 1;
      if (n < 3) throw new Error("boom");
      return "ok";
    }, 5);
    expect(v).toBe("ok");
  });
});
`,
  ],
  pagination: [
    `export interface Page<T> { items: T[]; total: number; pages: number }
export function page<T>(items: T[], n: number, perPage: number): Page<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const start = (n - 1) * perPage;
  return { items: items.slice(start, start + perPage), total, pages };
}
`,
    `import { describe, expect, it } from "vitest";
import { page } from "../src/pagination.js";
describe("pagination", () => {
  it("slices pages", () => {
    const r = page([1, 2, 3, 4, 5], 2, 2);
    expect(r.items).toEqual([3, 4]);
    expect(r.total).toBe(5);
  });
});
`,
  ],
  sorting: [
    `export function byKey<T>(key: keyof T, dir: "asc" | "desc" = "asc"): (a: T, b: T) => number {
  return (a, b) => {
    const x = a[key] as unknown as number | string;
    const y = b[key] as unknown as number | string;
    if (x === y) return 0;
    return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
  };
}
`,
    `import { describe, expect, it } from "vitest";
import { byKey } from "../src/sorting.js";
describe("sorting", () => {
  it("sorts both ways", () => {
    const rows = [{ n: 2 }, { n: 1 }];
    expect([...rows].sort(byKey("n"))[0].n).toBe(1);
  });
});
`,
  ],
  filtering: [
    `export function matchAll<T>(items: T[], preds: Array<(x: T) => boolean>): T[] {
  return items.filter((x) => preds.every((p) => p(x)));
}
export function matchAny<T>(items: T[], preds: Array<(x: T) => boolean>): T[] {
  return items.filter((x) => preds.some((p) => p(x)));
}
`,
    `import { describe, expect, it } from "vitest";
import { matchAll } from "../src/filtering.js";
describe("filtering", () => {
  it("ands predicates", () => {
    expect(matchAll([1, 2, 3, 4], [(x) => x > 1, (x) => x < 4])).toEqual([2, 3]);
  });
});
`,
  ],
  csv: [
    `export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.join(",")).join("\\n");
}
export function parseLine(line: string): string[] {
  return line.split(",");
}
`,
    `import { describe, expect, it } from "vitest";
import { parseLine } from "../src/csv.js";
describe("csv", () => {
  it("splits lines", () => {
    expect(parseLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
});
`,
  ],
  dates: [
    `export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return \`\${d.getFullYear()}-\${p(d.getMonth() + 1)}-\${p(d.getDate())}\`;
}
export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
`,
    `import { describe, expect, it } from "vitest";
import { fmtDate } from "../src/dates.js";
describe("dates", () => {
  it("formats", () => {
    expect(fmtDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
`,
  ],
  strings: [
    `export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "\\u2026";
}
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
`,
    `import { describe, expect, it } from "vitest";
import { slug, truncate } from "../src/strings.js";
describe("strings", () => {
  it("shapes text", () => {
    expect(truncate("abcdef", 4)).toBe("abc\\u2026");
    expect(slug("Hello World!")).toBe("hello-world");
  });
});
`,
  ],
  mathx: [
    `export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
export function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}
`,
    `import { describe, expect, it } from "vitest";
import { clamp, sum } from "../src/mathx.js";
describe("mathx", () => {
  it("computes", () => {
    expect(clamp(9, 0, 5)).toBe(5);
    expect(sum([1, 2, 3])).toBe(6);
  });
});
`,
  ],
};
for (const [name, mod] of Object.entries(coreMods)) {
  W(`core/src/${name}.ts`, mod[0]);
  W(`core/test/${name}.test.ts`, mod[1]);
}
W("core/src/index.ts", Object.keys(coreMods).map((n) => `export * from "./${n}.js";`).join("\n") + "\n");

// ---------- shop catalog (generated data) ----------
const PREFIX = ["WDG", "GDG", "SPR", "COG", "BLT", "PNL"];
const items = [];
for (let i = 0; i < 24; i++) {
  const code = `${PREFIX[i % PREFIX.length]}-${String(Math.floor(i / PREFIX.length) + 1).padStart(3, "0")}`;
  items.push({
    code,
    name: `${pick(ADJ)} ${pick(NOUN)}`,
    priceCents: rint(5, 500) * 100,
  });
}
const itemLines = items.map((it) => `  { code: "${it.code}", name: "${it.name}", priceCents: ${it.priceCents} },`).join("\n");
W("shop/src/catalog.ts", `import type { Sku } from "../../shared/src/types.js";
export const CATALOG: Sku[] = [
${itemLines}
];
export function findBySku(code: string): Sku | undefined {
  return CATALOG.find((i) => i.code === code);
}
export function listSkus(): string[] {
  return CATALOG.map((i) => i.code);
}
`);
const first = items[0];
W("shop/test/catalog.test.ts", `import { describe, expect, it } from "vitest";
import { findBySku, listSkus } from "../src/catalog.js";
describe("catalog", () => {
  it("finds skus", () => {
    expect(findBySku("${first.code}")?.priceCents).toBe(${first.priceCents});
    expect(findBySku("NOPE-000")).toBeUndefined();
    expect(listSkus().length).toBe(24);
  });
});
`);

// ---------- shop flow (hand-written, real) ----------
W("shop/src/cart.ts", `import { findBySku } from "./catalog.js";
export interface CartLine { sku: string; qty: number }
export function addLine(cart: CartLine[], sku: string, qty: number): CartLine[] {
  if (qty < 1) throw new Error("qty must be >= 1");
  if (!findBySku(sku)) throw new Error("unknown sku " + sku);
  const line = cart.find((l) => l.sku === sku);
  if (line) return cart.map((l) => (l.sku === sku ? { sku, qty: l.qty + qty } : l));
  return [...cart, { sku, qty }];
}
export function removeLine(cart: CartLine[], sku: string): CartLine[] {
  return cart.filter((l) => l.sku !== sku);
}
export function subtotal(cart: CartLine[]): number {
  return cart.reduce((sum, l) => {
    const item = findBySku(l.sku);
    if (!item) throw new Error("unknown sku " + l.sku);
    return sum + item.priceCents * l.qty;
  }, 0);
}
`);
W("shop/src/pricing.ts", `export interface Discount { pct?: number; fixedCents?: number }
export function applyDiscount(subtotalCents: number, d: Discount): number {
  const afterFixed = Math.max(0, subtotalCents - (d.fixedCents ?? 0));
  return Math.round((afterFixed * (100 - (d.pct ?? 0))) / 100);
}
`);
W("shop/src/tax.ts", `import { TAX_RATES } from "../../shared/src/constants.js";
import type { Region } from "../../shared/src/types.js";
export function rateFor(region: Region): number {
  return TAX_RATES[region];
}
export function taxAmount(discountedCents: number, region: Region): number {
  return Math.round((discountedCents * rateFor(region)) / 100);
}
`);
W("shop/src/orders.ts", `import { newId } from "../../shared/src/ids.js";
import type { Region } from "../../shared/src/types.js";
import { type CartLine, subtotal } from "./cart.js";
import { type Discount, applyDiscount } from "./pricing.js";
import { taxAmount } from "./tax.js";
export interface Order {
  id: string;
  lines: CartLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  region: Region;
}
export function createOrder(lines: CartLine[], region: Region, discount: Discount = {}): Order {
  const sub = subtotal(lines);
  const disc = applyDiscount(sub, discount);
  const tax = taxAmount(disc, region);
  return { id: newId("order"), lines, subtotal: sub, discount: sub - disc, tax, total: disc + tax, region };
}
`);
W("shop/src/shipping.ts", `import { FLAT_SHIP_CENTS, FREE_SHIP_CENTS } from "../../shared/src/constants.js";
export function shipCost(subtotalCents: number): number {
  if (subtotalCents >= FREE_SHIP_CENTS) return 0;
  if (subtotalCents >= 5000) return 500;
  return FLAT_SHIP_CENTS;
}
`);
W("shop/src/inventory.ts", `const stock = new Map<string, number>();
export function stockFor(sku: string): number {
  let h = 0;
  for (const c of sku) h = (h * 31 + c.charCodeAt(0)) % 400;
  return 100 + h;
}
export function reserve(sku: string, qty: number): boolean {
  const left = (stock.get(sku) ?? stockFor(sku)) - qty;
  if (left < 0) return false;
  stock.set(sku, left);
  return true;
}
export function release(sku: string, qty: number): void {
  stock.set(sku, (stock.get(sku) ?? stockFor(sku)) + qty);
}
export function clearStock(): void {
  stock.clear();
}
`);
W("shop/src/coupons.ts", `import type { Discount } from "./pricing.js";
export const COUPONS: Record<string, Discount> = {
  SAVE10: { pct: 10 },
  FLAT5: { fixedCents: 500 },
};
export function validateCode(code: string): Discount | null {
  return COUPONS[code] ?? null;
}
`);
const shopSmall = {
  returns: [`export function returnTotal(paidCents: number, restockFeePct: number): number {
  return Math.round((paidCents * (100 - restockFeePct)) / 100);
}
`, `import { describe, expect, it } from "vitest";
import { returnTotal } from "../src/returns.js";
describe("returns", () => {
  it("deducts restock fee", () => {
    expect(returnTotal(1000, 10)).toBe(900);
  });
});
`],
  reviews: [`export function avgStars(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
}
`, `import { describe, expect, it } from "vitest";
import { avgStars } from "../src/reviews.js";
describe("reviews", () => {
  it("averages", () => {
    expect(avgStars([5, 4, 5])).toBe(4.7);
  });
});
`],
  wishlist: [`export function toggle(list: string[], sku: string): string[] {
  return list.includes(sku) ? list.filter((s) => s !== sku) : [...list, sku];
}
`, `import { describe, expect, it } from "vitest";
import { toggle } from "../src/wishlist.js";
describe("wishlist", () => {
  it("toggles", () => {
    expect(toggle([], "A")).toEqual(["A"]);
    expect(toggle(["A"], "A")).toEqual([]);
  });
});
`],
  giftcards: [`export function applyGift(totalCents: number, valueCents: number): { charged: number; remaining: number } {
  const charged = Math.max(0, totalCents - valueCents);
  return { charged, remaining: Math.max(0, valueCents - totalCents) };
}
`, `import { describe, expect, it } from "vitest";
import { applyGift } from "../src/giftcards.js";
describe("giftcards", () => {
  it("splits charge", () => {
    expect(applyGift(1000, 400)).toEqual({ charged: 600, remaining: 0 });
    expect(applyGift(100, 400)).toEqual({ charged: 0, remaining: 300 });
  });
});
`],
  loyalty: [`export function pointsFor(spentCents: number): number {
  return Math.floor(spentCents / 100);
}
`, `import { describe, expect, it } from "vitest";
import { pointsFor } from "../src/loyalty.js";
describe("loyalty", () => {
  it("earns a point per dollar", () => {
    expect(pointsFor(250)).toBe(2);
  });
});
`],
  bundles: [`export function bundlePrice(itemsCents: number[], pctOffBund: number): number {
  const sub = itemsCents.reduce((a, b) => a + b, 0);
  return Math.round((sub * (100 - pctOffBund)) / 100);
}
`, `import { describe, expect, it } from "vitest";
import { bundlePrice } from "../src/bundles.js";
describe("bundles", () => {
  it("discounts bundles", () => {
    expect(bundlePrice([1000, 1000], 10)).toBe(1800);
  });
});
`],
  subscriptions: [`export function cyclesPerYear(freq: "monthly" | "yearly"): number {
  return freq === "monthly" ? 12 : 1;
}
`, `import { describe, expect, it } from "vitest";
import { cyclesPerYear } from "../src/subscriptions.js";
describe("subscriptions", () => {
  it("counts cycles", () => {
    expect(cyclesPerYear("monthly")).toBe(12);
  });
});
`],
  invoices: [`export function invoiceTotal(subtotal: number, tax: number, shipping: number): number {
  return subtotal + tax + shipping;
}
`, `import { describe, expect, it } from "vitest";
import { invoiceTotal } from "../src/invoices.js";
describe("invoices", () => {
  it("adds up", () => {
    expect(invoiceTotal(1000, 80, 0)).toBe(1080);
  });
});
`],
};
for (const [name, mod] of Object.entries(shopSmall)) {
  W(`shop/src/${name}.ts`, mod[0]);
  W(`shop/test/${name}.test.ts`, mod[1]);
}
W("shop/test/cart.test.ts", `import { describe, expect, it } from "vitest";
import { addLine, removeLine, subtotal } from "../src/cart.js";
describe("cart", () => {
  it("adds and totals", () => {
    let cart = addLine([], "${first.code}", 2);
    expect(subtotal(cart)).toBe(${first.priceCents} * 2);
    cart = removeLine(cart, "${first.code}");
    expect(subtotal(cart)).toBe(0);
  });
});
`);
W("shop/test/pricing.test.ts", `import { describe, expect, it } from "vitest";
import { applyDiscount } from "../src/pricing.js";
describe("pricing", () => {
  it("handles single discounts", () => {
    expect(applyDiscount(10000, {})).toBe(10000);
    expect(applyDiscount(10000, { pct: 10 })).toBe(9000);
    expect(applyDiscount(10000, { fixedCents: 500 })).toBe(9500);
  });
});
`);
W("shop/test/tax.test.ts", `import { describe, expect, it } from "vitest";
import { rateFor, taxAmount } from "../src/tax.js";
describe("tax", () => {
  it("rates regions", () => {
    expect(rateFor("XA")).toBe(8);
    expect(rateFor("XB")).toBe(0);
    expect(taxAmount(10000, "XA")).toBe(800);
  });
});
`);
W("shop/test/orders.test.ts", `import { describe, expect, it } from "vitest";
import { createOrder } from "../src/orders.js";
describe("orders", () => {
  it("totals without discount", () => {
    const o = createOrder([{ sku: "${first.code}", qty: 1 }], "XB", {});
    expect(o.subtotal).toBe(${first.priceCents});
    expect(o.tax).toBe(0);
    expect(o.total).toBe(${first.priceCents});
  });
});
`);
W("shop/test/coupons.test.ts", `import { describe, expect, it } from "vitest";
import { validateCode } from "../src/coupons.js";
describe("coupons", () => {
  it("validates codes", () => {
    expect(validateCode("SAVE10")).toEqual({ pct: 10 });
    expect(validateCode("NOPE")).toBeNull();
  });
});
`);
W("shop/test/inventory.test.ts", `import { describe, expect, it } from "vitest";
import { clearStock, reserve, stockFor } from "../src/inventory.js";
describe("inventory", () => {
  it("reserves stock", () => {
    clearStock();
    const s = stockFor("${first.code}");
    expect(s).toBeGreaterThanOrEqual(100);
    expect(reserve("${first.code}", s + 1)).toBe(false);
    expect(reserve("${first.code}", 2)).toBe(true);
  });
});
`);

// ---------- api ----------
W("api/src/receipt.ts", `import { formatMoney } from "../../shared/src/money.js";
import type { Order } from "../../shop/src/orders.js";
export function receiptText(o: Order): string {
  const lines = o.lines.map((l) => \`\${l.qty}x \${l.sku}\`);
  return [
    \`order \${o.id}\`,
    ...lines,
    \`subtotal \${formatMoney(o.subtotal)}\`,
    \`discount \${formatMoney(o.discount)}\`,
    \`tax \${formatMoney(o.tax)}\`,
    \`total \${formatMoney(o.total)}\`,
  ].join("\\n");
}
`);
W("api/src/formatter.ts", `export function moneyCol(cents: number, width: number): string {
  return String(cents).padStart(width, " ");
}
export function row(cells: string[]): string {
  return cells.join(" | ");
}
`);
W("api/test/receipt.test.ts", `import { describe, expect, it } from "vitest";
import { createOrder } from "../../shop/src/orders.js";
import { receiptText } from "../src/receipt.js";
describe("receipt", () => {
  it("renders totals", () => {
    const o = createOrder([{ sku: "${first.code}", qty: 1 }], "XB", {});
    const t = receiptText(o);
    expect(t).toContain("total $");
    expect(t).toContain(o.id);
  });
});
`);
const routes = [
  ["cart", "addToCart", "sku: string, qty: number", "findBySku(sku) ? (qty < 1 ? err(\"qty must be >= 1\") : ok(`added ${qty}x ${sku}`)) : err(`unknown sku ${sku}`)", `import { err, ok } from "../../../shared/src/result.js";\nimport { findBySku } from "../../../shop/src/catalog.js";`],
  ["orders", "getOrder", "id: string", `id.length > 0 ? ok(\`order \${id}\`) : err("empty id")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["products", "getProduct", "sku: string", `(() => { const p = findBySku(sku); return p ? ok(p.name) : err("unknown sku"); })()`, `import { err, ok } from "../../../shared/src/result.js";\nimport { findBySku } from "../../../shop/src/catalog.js";`],
  ["checkout", "checkout", "lines: number", `lines > 0 ? ok(\`checkout \${lines} lines\`) : err("empty cart")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["coupon", "applyCoupon", "code: string", `validateCode(code) ? ok(\`coupon \${code}\`) : err("bad code")`, `import { err, ok } from "../../../shared/src/result.js";\nimport { validateCode } from "../../../shop/src/coupons.js";`],
  ["returns", "startReturn", "orderId: string", `orderId.length > 3 ? ok(\`return \${orderId}\`) : err("bad order")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["reviews", "addReview", "stars: number", `(stars >= 1 && stars <= 5) ? ok(\`review \${stars}\`) : err("stars 1-5")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["inventory", "checkStock", "sku: string", `ok(\`stock \${stockFor(sku)}\`)`, `import { ok } from "../../../shared/src/result.js";\nimport { stockFor } from "../../../shop/src/inventory.js";`],
  ["shipping", "quoteShipping", "subtotal: number", `ok(\`ship \${shipCost(subtotal)}\`)`, `import { ok } from "../../../shared/src/result.js";\nimport { shipCost } from "../../../shop/src/shipping.js";`],
  ["tax", "quoteTax", "cents: number", `ok(\`tax \${taxAmount(cents, "XA")}\`)`, `import { ok } from "../../../shared/src/result.js";\nimport { taxAmount } from "../../../shop/src/tax.js";`],
  ["user", "getUser", "id: string", `id.length > 0 ? ok(\`user \${id}\`) : err("empty id")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["auth", "hasRole", "headers: Record<string, string>, role: string", `headers["x-role"] === role ? ok(role) : err("forbidden")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["search", "searchCatalog", "q: string", `ok(listSkus().filter((s) => s.includes(q.toUpperCase())).join(","))`, `import { ok } from "../../../shared/src/result.js";\nimport { listSkus } from "../../../shop/src/catalog.js";`],
  ["wishlist", "addWish", "sku: string", `findBySku(sku) ? ok(sku) : err("unknown sku")`, `import { err, ok } from "../../../shared/src/result.js";\nimport { findBySku } from "../../../shop/src/catalog.js";`],
  ["health", "health", "", `ok("up")`, `import { ok } from "../../../shared/src/result.js";`],
  ["webhook", "ingest", "kind: string", `kind.length > 0 ? ok(kind) : err("empty kind")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["adminusers", "banUser", "id: string", `id.startsWith("admin") ? err("cannot ban admin") : ok(id)`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["adminorders", "refundOrder", "id: string", `id.length > 0 ? ok(\`refund \${id}\`) : err("empty id")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["reports", "salesReport", "days: number", `days > 0 ? ok(\`report \${days}d\`) : err("bad range")`, `import { err, ok } from "../../../shared/src/result.js";`],
  ["settings", "getSetting", "key: string", `key.length > 0 ? ok(\`setting \${key}\`) : err("empty key")`, `import { err, ok } from "../../../shared/src/result.js";`],
];
for (const [name, fn, sig, body, imports] of routes) {
  W(`api/src/routes/${name}.ts`, `${imports}
export function ${fn}(${sig}): unknown {
  return ${body};
}
`);
}
W("api/test/routes.test.ts", `import { describe, expect, it } from "vitest";
import { addToCart } from "../src/routes/cart.js";
import { applyCoupon } from "../src/routes/coupon.js";
import { health } from "../src/routes/health.js";
describe("routes", () => {
  it("handles happy and sad paths", () => {
    expect(addToCart("${first.code}", 1)).toMatchObject({ ok: true });
    expect(addToCart("NOPE-0", 1)).toMatchObject({ ok: false });
    expect(applyCoupon("SAVE10")).toMatchObject({ ok: true });
    expect(health()).toMatchObject({ ok: true });
  });
});
`);
const mwares = {
  auth: [`export function hasRole(headers: Record<string, string>, role: string): boolean {
  return headers["x-role"] === role;
}
`, `import { describe, expect, it } from "vitest";
import { hasRole } from "../src/middleware/auth.js";
describe("mware auth", () => {
  it("checks roles", () => {
    expect(hasRole({ "x-role": "admin" }, "admin")).toBe(true);
    expect(hasRole({}, "admin")).toBe(false);
  });
});
`],
  logging: [`export function logLine(method: string, path: string): string {
  return \`\${method} \${path}\`;
}
`, ""],
  validation: [`export function problems(body: unknown): string[] {
  const out: string[] = [];
  if (typeof body !== "object" || body === null) out.push("body must be an object");
  return out;
}
`, `import { describe, expect, it } from "vitest";
import { problems } from "../src/middleware/validation.js";
describe("mware validation", () => {
  it("rejects junk", () => {
    expect(problems(null)).toEqual(["body must be an object"]);
    expect(problems({})).toEqual([]);
  });
});
`],
  errors: [`export function errorToResponse(code: string): { status: number; body: string } {
  const known: Record<string, number> = { NOT_FOUND: 404, VALIDATION: 400 };
  return { status: known[code] ?? 500, body: code };
}
`, `import { describe, expect, it } from "vitest";
import { errorToResponse } from "../src/middleware/errors.js";
describe("mware errors", () => {
  it("maps codes", () => {
    expect(errorToResponse("NOT_FOUND").status).toBe(404);
    expect(errorToResponse("WEIRD").status).toBe(500);
  });
});
`],
  cors: [`export function corsHeaders(origin: string): Record<string, string> {
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST" };
}
`, ""],
  ratelimit: [`export function overLimit(count: number, limit: number): boolean {
  return count >= limit;
}
`, `import { describe, expect, it } from "vitest";
import { overLimit } from "../src/middleware/ratelimit.js";
describe("mware ratelimit", () => {
  it("caps", () => {
    expect(overLimit(10, 10)).toBe(true);
    expect(overLimit(9, 10)).toBe(false);
  });
});
`],
  requestid: [`let n = 0;
export function requestId(): string {
  n += 1;
  return \`req-\${n}\`;
}
`, ""],
  timeout: [`export function timeoutMs(kind: string): number {
  return { fast: 1000, slow: 30000 }[kind] ?? 5000;
}
`, ""],
};
for (const [name, mod] of Object.entries(mwares)) {
  W(`api/src/middleware/${name}.ts`, mod[0]);
  if (mod[1]) W(`api/test/mw-${name}.test.ts`, mod[1]);
}

// ---------- web (pure render fns, no JSX) ----------
const comps = [
  ["button", "renderButton", "label: string", "`<button>${label}</button>`"],
  ["price", "renderPrice", "cents: number", "`<span class=price>${formatMoney(cents)}</span>`", `import { formatMoney } from "../../../shared/src/money.js";`],
  ["badge", "renderBadge", "text: string, kind: string", "`<span class=badge-${kind}>${text}</span>`"],
  ["cartline", "renderCartLine", "sku: string, qty: number", "`<li>${qty}x ${sku}</li>`"],
  ["orderrow", "renderOrderRow", "id: string, total: number", "`<tr><td>${id}</td><td>${total}</td></tr>`"],
  ["stars", "renderStars", "n: number", "`${\"*\".repeat(n)}`"],
  ["header", "renderHeader", "title: string", "`<h1>${title}</h1>`"],
  ["footer", "renderFooter", "year: number", "`<footer>${year}</footer>`"],
  ["input", "renderInput", "name: string", "`<input name=${name}/>`"],
  ["table", "renderTable", "rows: string[][]", "`rows.map((r) => r.join('|')).join('\\\\n')`"],
  ["alert", "renderAlert", "msg: string", "`<div class=alert>${msg}</div>`"],
  ["link", "renderLink", "href: string, text: string", "`<a href=${href}>${text}</a>`"],
  ["image", "renderImage", "src: string, alt: string", "`<img src=${src} alt=${alt}/>`"],
  ["form", "renderForm", "action: string", "`<form action=${action}></form>`"],
  ["select", "renderSelect", "opts: string[]", "\"<option>\" + opts.join('</option><option>') + '</option>'"],
  ["nav", "renderNav", "items: string[]", "\"<a>\" + items.join('</a> <a>') + '</a>'"],
  ["card", "renderCard", "title: string, body: string", "`<div class=card><h2>${title}</h2><p>${body}</p></div>`"],
  ["modal", "renderModal", "body: string", "`<div class=modal>${body}</div>`"],
  ["toast", "renderToast", "msg: string", "`<div class=toast>${msg}</div>`"],
  ["empty", "renderEmpty", "", "`<p class=empty>none</p>`"],
];
for (const [name, fn, sig, body, imp] of comps) {
  W(`web/src/components/${name}.ts`, `${imp ? imp + "\n" : ""}export function ${fn}(${sig}): string {
  return ${body};
}
`);
}
W("web/test/components.test.ts", `import { describe, expect, it } from "vitest";
import { renderButton } from "../src/components/button.js";
import { renderPrice } from "../src/components/price.js";
import { renderStars } from "../src/components/stars.js";
describe("components", () => {
  it("renders", () => {
    expect(renderButton("Go")).toBe("<button>Go</button>");
    expect(renderPrice(1050)).toBe("<span class=price>$10.50</span>");
    expect(renderStars(3)).toBe("***");
  });
});
`);
const pages = ["home", "cart", "checkout", "product", "orders", "search", "account", "admin", "help", "status"];
for (const p of pages) {
  W(`web/src/pages/${p}.ts`, `import { renderHeader } from "../components/header.js";
import { renderFooter } from "../components/footer.js";
export function page${p[0].toUpperCase() + p.slice(1)}(): string {
  return renderHeader("${p}") + renderFooter(2026);
}
`);
}
W("web/test/pages.test.ts", `import { describe, expect, it } from "vitest";
import { pageCart } from "../src/pages/cart.js";
describe("pages", () => {
  it("composes", () => {
    expect(pageCart()).toContain("<h1>cart</h1>");
  });
});
`);

// ---------- entities: CRUD stores + tests (volume + realism) ----------
const entities = ["product", "customer", "coupon", "review", "ticket", "invoice", "shipment", "payment", "refund", "session", "apitoken", "webhook", "report", "board", "alert", "rule", "policy", "template", "snippet", "bookmark", "note", "tag", "category", "brand", "vendor", "depot", "batch", "job", "taskitem", "ledger"];
for (const e of entities) {
  const Name = e[0].toUpperCase() + e.slice(1);
  W(`shop/src/entities/${e}.ts`, `import { newId } from "../../../shared/src/ids.js";
export interface ${Name} { id: string; name: string; meta: string }
const store = new Map<string, ${Name}>();
export function create${Name}(name: string, meta = ""): ${Name} {
  const e: ${Name} = { id: newId("${e}"), name, meta };
  store.set(e.id, e);
  return e;
}
export function get${Name}(id: string): ${Name} | undefined {
  return store.get(id);
}
export function list${Name}s(): ${Name}[] {
  return [...store.values()];
}
export function remove${Name}(id: string): boolean {
  return store.delete(id);
}
export function clear${Name}s(): void {
  store.clear();
}
export function summarize${Name}(e: ${Name}): string {
  return \`\${e.name} (\${e.id})\`;
}
`);
  W(`shop/test/ent-${e}.test.ts`, `import { describe, expect, it } from "vitest";
import { clear${Name}s, create${Name}, get${Name}, list${Name}s, remove${Name}, summarize${Name} } from "../src/entities/${e}.js";
describe("${e}", () => {
  it("cruds", () => {
    clear${Name}s();
    const e = create${Name}("alpha", "m");
    expect(get${Name}(e.id)?.name).toBe("alpha");
    expect(list${Name}s()).toHaveLength(1);
    expect(summarize${Name}(e)).toContain("alpha");
    expect(remove${Name}(e.id)).toBe(true);
    expect(list${Name}s()).toHaveLength(0);
  });
});
`);
}

// ---------- scripts/order-total.ts (T1 fixture, deterministic) ----------
W("scripts/order-total.ts", `import { createOrder } from "../shop/src/orders.js";
const order = createOrder([{ sku: "${first.code}", qty: 2 }], "XA", { pct: 10 });
console.log(\`lines: \${order.lines.length}\`);
console.log(\`subtotal: \${order.subtotal}\`);
console.log(\`discount: \${order.discount}\`);
console.log(\`tax: \${order.tax}\`);
console.log(\`total: \${order.total}\`);
`);

console.log("megabox generated");
