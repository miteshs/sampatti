// Club the SAME instrument held across multiple accounts into one row — so HDFC Bank in two
// brokers reads as one position, not two smaller ones. The concentration math (brief.ts) already
// aggregates by name for HHI; this is the display-side equivalent for the holdings/P&L tables.
// Pure (no store): callers pass the visible holdings + accounts + the live ₹/$ rate.

import { holdingBase, holdingGain, type HoldingGain } from "./format";
import type { Account, AssetClass, Holding } from "./types";

export interface GroupedHolding {
  key: string;
  name: string;
  symbol?: string;      // representative ticker/ISIN (for tickerOf)
  assetClass: AssetClass;
  value: number;        // INR base, summed over every leg
  accounts: string[];   // distinct account names holding it, by value desc
  legs: number;         // how many accounts it's spread across
  gain: HoldingGain | null; // combined P&L over the REAL-basis legs only (null if none)
}

// The exchange ticker to show in parens after a name — but ONLY when it's actually a ticker:
// equities/ETFs whose symbol isn't a 12-char ISIN or a numeric (AMFI) scheme code. Mutual-fund
// folios etc. keep their names clean instead of showing an ISIN nobody recognizes.
const TICKER_CLASSES = new Set<AssetClass>(["indian_equity", "us_equity", "index_etf"]);
export function tickerOf(symbol: string | undefined, assetClass: AssetClass): string | null {
  const s = (symbol ?? "").trim().toUpperCase();
  if (!s || !TICKER_CLASSES.has(assetClass)) return null;
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return null; // ISIN, not a ticker
  if (/^\d+$/.test(s)) return null;                       // numeric scheme code
  if (s.length > 12) return null;
  return s;
}

// Group key: a real ticker/ISIN/scheme code when present (the reliable identity), else the
// normalized name + asset class (so "HDFC Bank" and "hdfc bank " coalesce, but a stock and a
// same-named fund don't).
export function instrumentKey(h: Holding): string {
  const sym = (h.symbol ?? "").trim().toUpperCase();
  if (sym) return `sym:${sym}`;
  return `nm:${h.name.trim().toLowerCase().replace(/\s+/g, " ")}|${h.assetClass}`;
}

export function groupHoldings(holdings: Holding[], accounts: Account[], usdInr: number): GroupedHolding[] {
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  interface Acc { name: string; symbol?: string; assetClass: AssetClass; value: number; invested: number; realValue: number; hasReal: boolean; accs: Map<string, number> }
  const m = new Map<string, Acc>();
  for (const h of holdings) {
    const key = instrumentKey(h);
    const v = holdingBase(h, usdInr);
    let e = m.get(key);
    if (!e) { e = { name: h.name, symbol: h.symbol, assetClass: h.assetClass, value: 0, invested: 0, realValue: 0, hasReal: false, accs: new Map() }; m.set(key, e); }
    if (!e.symbol && h.symbol) e.symbol = h.symbol;
    e.value += v;
    const aname = acctById.get(h.accountId)?.name ?? "—";
    e.accs.set(aname, (e.accs.get(aname) ?? 0) + v);
    const g = holdingGain(h, usdInr);
    if (g && !g.estimated) { e.hasReal = true; e.invested += g.invested; e.realValue += v; }
  }
  const out: GroupedHolding[] = [];
  for (const [key, e] of m) {
    const gain: HoldingGain | null = e.hasReal
      ? { invested: e.invested, gain: e.realValue - e.invested, gainPct: e.invested > 0 ? Math.round(((e.realValue - e.invested) / e.invested) * 1000) / 10 : null, estimated: false }
      : null;
    out.push({
      key, name: e.name, symbol: e.symbol, assetClass: e.assetClass, value: Math.round(e.value),
      accounts: [...e.accs.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
      legs: e.accs.size, gain,
    });
  }
  return out.sort((a, b) => b.value - a.value);
}
