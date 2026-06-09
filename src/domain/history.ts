// Reconstruct PAST net worth from historical prices, anchored to each holding's CURRENT
// value. We don't need units or absolute historical prices — only the *relative* change of a
// price series: value(t) = currentValue × price(t)/price(now). Holdings we can't price
// (real estate, FDs, cash, PMS, insurance…) carry flat at their current value. The result is
// an honest "what was my net worth worth then, given today's mix" reconstruction.
//
// This module is PURE (no network): the caller injects a `resolve(holding) → series`. The
// series fetching lives in market.ts so this stays unit-testable.

import { holdingBase } from "./format";
import type { Account, Holding } from "./types";

export interface PricePoint { t: number; price: number; } // t = epoch ms, ascending
export type Series = PricePoint[];
export type Period = "1M" | "3M" | "YTD" | "1Y";
export const PERIODS: Period[] = ["1M", "3M", "YTD", "1Y"];

// Start of the lookback window for a period.
export function periodStart(period: Period, now = Date.now()): number {
  const d = new Date(now);
  switch (period) {
    case "1M": d.setMonth(d.getMonth() - 1); break;
    case "3M": d.setMonth(d.getMonth() - 3); break;
    case "1Y": d.setFullYear(d.getFullYear() - 1); break;
    case "YTD": return new Date(d.getFullYear(), 0, 1).getTime();
  }
  return d.getTime();
}

// Latest known price (last point) and the price at-or-before a time. Series is ascending.
export const latestPrice = (s: Series): number | null => (s.length ? s[s.length - 1].price : null);
export function priceAt(series: Series, t: number): number | null {
  let v: number | null = null;
  for (const p of series) { if (p.t <= t) v = p.price; else break; }
  return v;
}

// Roughly N evenly spaced sample times across [start, now], always including `now`.
export function sampleDates(start: number, now = Date.now(), target = 40): number[] {
  const span = Math.max(now - start, 1);
  const step = Math.max(86_400_000, Math.floor(span / target)); // ≥ 1 day
  const out: number[] = [];
  for (let t = start; t < now; t += step) out.push(t);
  out.push(now);
  return out;
}

export interface NetWorthPoint { t: number; netWorth: number; }

// Net worth at each sample time. `resolve` returns a price series for a holding, or null when
// it isn't trackable (→ carried flat at its current value).
export function reconstruct(
  holdings: Holding[],
  accounts: Account[],
  usdInr: number,
  resolve: (h: Holding) => Series | null,
  dates: number[],
): NetWorthPoint[] {
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  return dates.map((t) => {
    let assets = 0;
    let liabilities = 0;
    for (const h of holdings) {
      const series = resolve(h);
      let factor = 1;
      if (series && series.length) {
        const now = latestPrice(series);
        const then = priceAt(series, t);
        if (now && then && now > 0) factor = then / now;
      }
      const base = holdingBase({ ...h, marketValue: h.marketValue * factor }, usdInr);
      if (acctById.get(h.accountId)?.accountType === "liability") liabilities += base;
      else assets += base;
    }
    return { t, netWorth: Math.round(assets - liabilities) };
  });
}

// Convenience: change between the first and last point of a reconstructed series.
export function periodChange(points: NetWorthPoint[]): { abs: number; pct: number | null } {
  if (points.length < 2) return { abs: 0, pct: null };
  const first = points[0].netWorth;
  const last = points[points.length - 1].netWorth;
  return { abs: last - first, pct: first ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : null };
}
