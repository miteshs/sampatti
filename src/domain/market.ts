// Historical & live price data for net-worth reconstruction and live revaluation. Sources,
// all free and public (only a ticker/ISIN leaves the device — never your holdings):
//   • Yahoo Finance chart API — listed equities/ETFs (NSE `.NS`, US plain) and gold (`GC=F`).
//   • api.mfapi.in — Indian mutual-fund NAV history by AMFI scheme code.
//   • AMFI NAVAll.txt — maps a fund's ISIN → scheme code (so we can hit mfapi).
// On desktop the request is made from Rust (no CORS, allow-listed hosts); on web we use fetch
// (only the CORS-enabled host, mfapi, will succeed). Everything is best-effort: a failure
// yields an empty series and the holding simply carries flat.

import { isTauri } from "../platform";
import type { Holding } from "./types";
import type { Series } from "./history";

const AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const YH = "https://query1.finance.yahoo.com/v8/finance/chart/";
const MFAPI = "https://api.mfapi.in/mf/";

// One GET, returning the body text. Desktop → Rust (bypasses CORS); web → fetch.
export async function marketGet(url: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("market_fetch", { url });
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.text();
}
const marketJson = async <T = unknown>(url: string): Promise<T> => JSON.parse(await marketGet(url)) as T;

// ---- pure parsers (exported for tests) -------------------------------------

const isIsin = (s: string) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s);
// A plausible exchange ticker (not an ISIN, not a numeric bond CUSIP).
const plausibleTicker = (s: string) => /^[A-Z][A-Z0-9.&-]{0,11}$/.test(s) && !isIsin(s);

// Yahoo chart JSON → ascending price series (skips null closes).
export function parseYahoo(json: unknown): Series {
  const r = (json as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } })
    ?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const close = r?.indicators?.quote?.[0]?.close ?? [];
  const out: Series = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c === "number" && Number.isFinite(c)) out.push({ t: ts[i] * 1000, price: c });
  }
  return out;
}

// mfapi.in JSON → ascending NAV series. Dates are "dd-mm-yyyy".
export function parseMfapi(json: unknown): Series {
  const data = (json as { data?: { date?: string; nav?: string }[] })?.data ?? [];
  const out: Series = [];
  for (const row of data) {
    const [d, m, y] = String(row.date ?? "").split("-").map(Number);
    const nav = Number(row.nav);
    if (d && m && y && Number.isFinite(nav) && nav > 0) out.push({ t: Date.UTC(y, m - 1, d), price: nav });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// AMFI NAVAll.txt → { ISIN → scheme code }. Lines: code;ISIN1;ISIN2;name;nav;date.
export function parseAmfiIsinMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const p = line.split(";");
    if (p.length < 6) continue;
    const code = p[0].trim();
    if (!/^\d+$/.test(code)) continue;
    for (const isin of [p[1].trim().toUpperCase(), p[2].trim().toUpperCase()]) {
      if (isin && isin !== "-" && isIsin(isin)) map.set(isin, code);
    }
  }
  return map;
}

const MF_CLASSES = new Set(["equity_mf", "debt_mf", "elss"]);
const isMfLike = (h: Holding) =>
  MF_CLASSES.has(h.assetClass) || (h.assetClass === "index_etf" && (h.currency || "INR").toUpperCase() === "INR");

// The Yahoo symbol for a holding, or null if it isn't a listed instrument we can map.
export function yahooSymbolFor(h: Holding): string | null {
  if (h.assetClass === "gold_sgb" || h.assetClass === "gold_other") return "GC=F"; // gold, USD/oz — relative only
  const sym = (h.symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  if (h.assetClass === "indian_equity") return plausibleTicker(sym) ? `${sym}.NS` : null;
  if (h.assetClass === "crypto") return plausibleTicker(sym) ? `${sym}-USD` : null;
  if (h.assetClass === "us_equity" || (h.assetClass === "index_etf" && (h.currency || "").toUpperCase() === "USD"))
    return plausibleTicker(sym) ? sym : null;
  return null;
}

// ---- network fetchers ------------------------------------------------------

export async function yahooHistory(symbol: string, range = "1y"): Promise<Series> {
  return parseYahoo(await marketJson(`${YH}${encodeURIComponent(symbol)}?range=${range}&interval=1d`));
}
export async function mfHistory(code: string): Promise<Series> {
  return parseMfapi(await marketJson(`${MFAPI}${code}`));
}

// Cache the (large) AMFI map for the session so we download it at most once.
let amfiCache: { day: string; map: Map<string, string> } | null = null;
async function amfiIsinMap(): Promise<Map<string, string>> {
  const day = new Date().toISOString().slice(0, 10);
  if (amfiCache?.day === day) return amfiCache.map;
  const map = parseAmfiIsinMap(await marketGet(AMFI_URL));
  amfiCache = { day, map };
  return map;
}

async function runPool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next);
  }));
}

export interface Resolver {
  resolve: (h: Holding) => Series | null;
  tracked: number;
  total: number;
}

// Fetch every price series the portfolio needs (deduped) and return a resolver. Best-effort:
// any single fetch failing just leaves that holding flat. Call once for ALL holdings so the
// chart can recompute on account include/exclude without re-fetching.
export async function buildResolver(holdings: Holding[], range = "1y"): Promise<Resolver> {
  const seriesByKey = new Map<string, Series>();
  const keyOf = new Map<string, string>();
  const tasks: { key: string; run: () => Promise<Series> }[] = [];

  let amfi: Map<string, string> | null = null;
  if (holdings.some(isMfLike)) { try { amfi = await amfiIsinMap(); } catch { amfi = null; } }

  for (const h of holdings) {
    let key: string | null = null;
    let run: (() => Promise<Series>) | null = null;

    if (isMfLike(h) && amfi) {
      const isin = (h.symbol ?? "").trim().toUpperCase();
      const code = isIsin(isin) ? amfi.get(isin) : /^\d{5,6}$/.test(isin) ? isin : undefined;
      if (code) { key = `mf:${code}`; run = () => mfHistory(code); }
    }
    if (!key) {
      const ysym = yahooSymbolFor(h);
      if (ysym) { key = `yh:${ysym}`; run = () => yahooHistory(ysym, range); }
    }
    if (key && run) {
      keyOf.set(h.id, key);
      if (!seriesByKey.has(key)) { seriesByKey.set(key, []); tasks.push({ key, run }); }
    }
  }

  await runPool(tasks, 6, async (t) => {
    try { seriesByKey.set(t.key, await t.run()); } catch { /* leave empty → flat */ }
  });

  const resolve = (h: Holding): Series | null => {
    const k = keyOf.get(h.id);
    const s = k ? seriesByKey.get(k) : undefined;
    return s && s.length ? s : null;
  };
  const tracked = holdings.filter((h) => resolve(h)).length;
  return { resolve, tracked, total: holdings.length };
}
