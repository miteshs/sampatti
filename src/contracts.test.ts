// PROMISE CONTRACTS — the app's three sacred claims, as executable assertions instead of
// culture. Anything failing here is a privacy/consistency incident, not a style nit:
//   1. The brief sent to Claude contains ONLY the agreed keys (no units/dates/folios/ids).
//   2. Network egress is a closed list: the CSP, the Rust market allowlist and the relay
//      default must agree — adding an endpoint requires consciously editing this contract.
//   3. The app and the relay agree on models; the three version files agree on the version.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrief } from "./domain/brief";
import { demoPortfolio } from "./demo";
import { visiblePortfolio, DEFAULT_RELAY_URL } from "./domain/types";
import { ANALYSIS_MODELS, EXTRACT_MODEL } from "./claude/transport";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ---- 1. the brief key-allowlist ---------------------------------------------

// Every key the brief may carry. byKind's children are income-kind names, checked separately.
const ALLOWED_KEYS = new Set([
  "asOf", "baseCurrency", "netWorth", "totalAssets", "totalLiabilities",
  "liquidAssets", "illiquidAssets", "liquidPct",
  "allocationByClass", "allocationByRegion", "allocationByTax", "allocationByAccountType",
  "label", "value", "percent",
  "concentration", "topHoldings", "name", "assetClass", "pctOfAssets", "account", "gainPct",
  "largestPctOfAssets", "largestPctOfLiquid", "top5PctOfLiquid", "hhi",
  "holdingPeriods", "equityShortTerm", "equityLongTerm", "withBuyDate",
  "taxWrappers", "taxable", "exemptEEE", "nps",
  "gains", "totalCostBasis", "unrealizedGain", "unrealizedPct", "realBasisPct",
  "income", "annualTotal", "byKind", "netWorthYears",
  "staleness", "freshAccounts", "agingAccounts", "staleAccounts",
  "notes",
]);
const INCOME_KINDS = new Set(["salary", "rent", "business", "dividend", "interest", "other"]);
// Keys that must NEVER appear anywhere in the payload sent to Claude.
const FORBIDDEN_KEYS = ["units", "buyDate", "buy_date", "costBasis", "symbol", "isin", "folio", "id", "accountId", "pan"];

function collectKeys(v: unknown, path: string, out: { key: string; path: string }[], underByKind = false) {
  if (Array.isArray(v)) { for (const x of v) collectKeys(x, `${path}[]`, out, underByKind); return; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push({ key: k, path: `${path}.${k}` });
      collectKeys(x, `${path}.${k}`, out, underByKind || k === "byKind");
    }
  }
}

describe("brief privacy contract", () => {
  const brief = buildBrief(visiblePortfolio(demoPortfolio()));
  const keys: { key: string; path: string }[] = [];
  collectKeys(brief, "brief", keys);

  it("contains only allow-listed keys", () => {
    const offenders = keys.filter(
      ({ key, path }) => !ALLOWED_KEYS.has(key) && !(path.includes(".byKind.") && INCOME_KINDS.has(key)),
    );
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("never carries the forbidden keys (units, dates, folios, ids…)", () => {
    const seen = new Set(keys.map((k) => k.key.toLowerCase()));
    for (const f of FORBIDDEN_KEYS) expect(seen.has(f.toLowerCase()), `brief must not contain "${f}"`).toBe(false);
  });

  it("the serialized brief leaks no ISIN-shaped identifiers", () => {
    expect(JSON.stringify(brief)).not.toMatch(/\bIN[EF][A-Z0-9]{9}\b/);
  });
});

// ---- 2. network egress is a closed, synchronized list -----------------------

describe("egress contract: CSP == Rust allowlist == known endpoints", () => {
  const csp: string = JSON.parse(read("src-tauri/tauri.conf.json")).app.security.csp;
  const connectSrc = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src"))!;
  const cspHosts = new Set(connectSrc.split(/\s+/).slice(1));

  const marketHosts = [...read("src-tauri/src/lib.rs").matchAll(/"([a-z0-9.]+\.[a-z]{2,})"/g)]
    .map((m) => m[1])
    .filter((h) => /yahoo|amfi|mfapi/.test(h)); // the MARKET_HOSTS block

  it("Rust market hosts are each allowed by the CSP", () => {
    expect(marketHosts.length).toBeGreaterThanOrEqual(5);
    for (const h of marketHosts) expect(cspHosts.has(`https://${h}`), `CSP missing https://${h}`).toBe(true);
  });

  it("the CSP connect-src is EXACTLY the agreed egress set", () => {
    const expected = new Set([
      "'self'",
      "https://api.anthropic.com",
      DEFAULT_RELAY_URL,
      "https://open.er-api.com", // USD→INR
      "https://api.gold-api.com", // gold ₹/g
      ...marketHosts.map((h) => `https://${h}`),
    ]);
    expect([...cspHosts].sort()).toEqual([...expected].sort());
  });
});

// ---- 3. cross-file consistency ----------------------------------------------

describe("local engine source contract", () => {
  it("the inference path in local_llm.rs contains no network client usage", () => {
    const src = read("src-tauri/src/local_llm.rs");
    const start = src.indexOf("// ---- inference");
    const end = src.indexOf("#[cfg(test)]"); // unit tests below contain URL fixtures
    const inference = src.slice(start, end > start ? end : undefined);
    expect(inference.length).toBeGreaterThan(100);
    expect(inference).not.toMatch(/reqwest|http|fetch|tcp|socket/i);
  });
});

describe("model and version consistency", () => {
  it("every app model is accepted by the relay", () => {
    const relay = read("relay/src/worker.ts");
    const allowed = new Set([...relay.matchAll(/"(claude-[a-z0-9.-]+)"/g)].map((m) => m[1]));
    for (const m of ANALYSIS_MODELS) expect(allowed.has(m.id), `relay missing ${m.id}`).toBe(true);
    expect(allowed.has(EXTRACT_MODEL), `relay missing extract model ${EXTRACT_MODEL}`).toBe(true);
  });

  it("package.json, tauri.conf.json and Cargo.toml agree on the version", () => {
    const pkg = JSON.parse(read("package.json")).version;
    const tauri = JSON.parse(read("src-tauri/tauri.conf.json")).version;
    const cargo = read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)![1];
    expect(tauri).toBe(pkg);
    expect(cargo).toBe(pkg);
  });
});
