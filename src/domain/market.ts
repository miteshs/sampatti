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
import { latestPrice, type Series } from "./history";
import { fetchGoldPerGramInr } from "./gold";

const AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt"; // www. now 302-redirects here
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
  // REITs/InvITs trade on the NSE like equities (EMBASSY, MINDSPACE, INDIGRID…).
  if (h.assetClass === "indian_equity" || h.assetClass === "reit_invit") return plausibleTicker(sym) ? `${sym}.NS` : null;
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

// A holding's identity for price purposes — symbol + class + currency. Stable across
// re-imports (which mint new holding ids) and used both to dedupe fetches and to look a
// holding's series back up from a persisted cache.
export const holdingSig = (h: Holding) => `${(h.symbol ?? "").trim().toUpperCase()}|${h.assetClass}|${(h.currency || "INR").toUpperCase()}`;

// The serializable payload behind a resolver — safe to JSON.stringify into localStorage so the
// chart survives an app restart without re-fetching.
export interface ResolverData {
  seriesByKey: Record<string, Series>;
  keyBySig: Record<string, string>; // holdingSig → series key
}

export interface Resolver {
  resolve: (h: Holding) => Series | null;
  tracked: number;
  total: number;
  data: ResolverData;
}

// Build a (pure) resolver from already-fetched series data. No network.
export function resolverFromData(data: ResolverData, holdings: Holding[]): Resolver {
  const resolve = (h: Holding): Series | null => {
    const k = data.keyBySig[holdingSig(h)];
    const s = k ? data.seriesByKey[k] : undefined;
    return s && s.length ? s : null;
  };
  return { resolve, tracked: holdings.filter((h) => resolve(h)).length, total: holdings.length, data };
}

// Whether a persisted cache still covers a portfolio: every holding that COULD be priced has a
// series in the cache (so adding a new tracked holding invalidates it, but editing values/
// excluding accounts does not).
export function coversHoldings(data: ResolverData, holdings: Holding[]): boolean {
  for (const h of holdings) {
    const sig = holdingSig(h);
    if (data.keyBySig[sig]) continue; // already have a series for it
    // No series cached for this holding — does it even have one to fetch?
    if (isMfLike(h) || yahooSymbolFor(h)) return false; // a priceable holding is missing
  }
  return true;
}

// Fetch every price series the portfolio needs (deduped) and return a resolver. Best-effort:
// any single fetch failing just leaves that holding flat. Call once for ALL holdings so the
// chart can recompute on account include/exclude without re-fetching.
export async function buildResolver(holdings: Holding[], range = "1y"): Promise<Resolver> {
  const seriesByKey = new Map<string, Series>();
  const keyBySig = new Map<string, string>();
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
      keyBySig.set(holdingSig(h), key);
      if (!seriesByKey.has(key)) { seriesByKey.set(key, []); tasks.push({ key, run }); }
    }
  }

  await runPool(tasks, 6, async (t) => {
    try { seriesByKey.set(t.key, await t.run()); } catch { /* leave empty → flat */ }
  });

  const data: ResolverData = { seriesByKey: Object.fromEntries(seriesByKey), keyBySig: Object.fromEntries(keyBySig) };
  return resolverFromData(data, holdings);
}

const isGold = (h: Holding) => h.assetClass === "gold_sgb" || h.assetClass === "gold_other";

export interface Revaluation {
  holdingId: string;
  oldValue: number;
  newValue: number; // in the holding's own currency
  price: number;
  units: number;
}

// Live revaluation: for each holding that has units AND a resolvable current price, compute
// units × latest price. Gold-by-weight uses the live ₹/g rate; everything else uses the latest
// close/NAV from the resolver. Holdings without units, or with no price, are left untouched.
// Best-effort: network failures simply yield fewer entries.
export async function liveRevalue(holdings: Holding[], usdInr: number): Promise<Revaluation[]> {
  const out: Revaluation[] = [];
  const priced = holdings.filter((h) => typeof h.units === "number" && h.units! > 0);

  // Gold shares one live ₹/g rate (units are grams). Handled apart from the relative GC=F series.
  const gold = priced.filter(isGold);
  if (gold.length) {
    const perGram = await fetchGoldPerGramInr(usdInr).catch(() => null);
    if (perGram) for (const h of gold) {
      out.push({ holdingId: h.id, oldValue: h.marketValue, newValue: Math.round(h.units! * perGram), price: perGram, units: h.units! });
    }
  }

  // Equities / ETFs / MFs: latest point of each price series × units (in the holding's currency).
  const listed = priced.filter((h) => !isGold(h));
  if (listed.length) {
    const { resolve } = await buildResolver(listed, "5d");
    for (const h of listed) {
      const price = latestPrice(resolve(h) ?? []);
      if (price && price > 0) {
        out.push({ holdingId: h.id, oldValue: h.marketValue, newValue: Math.round(h.units! * price), price, units: h.units! });
      }
    }
  }
  return out;
}
