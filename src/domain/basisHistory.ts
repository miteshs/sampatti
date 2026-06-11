// Pre-record history estimated from PURCHASE COSTS. For a holding with a real cost basis
// and buy date we know two true points — (buyDate, costBasis) and (today, value) — so we
// can sketch the years before the daily record began with a geometric path between them.
// Strictly opt-in data: estimated bases and basis-less holdings contribute NOTHING here
// (they join the chart when recording starts). The UI draws this era lighter and divided
// from the record — it's an estimate, never presented as fact.

import { toBase } from "./format";
import type { Holding } from "./types";

export interface BasisBand {
  accountId: string;
  values: number[]; // aligned with `times`; 0 before the account's first buy
}

const usable = (h: Holding) => h.costBasis != null && !h.costBasisEstimated && !!h.buyDate && h.costBasis! > 0;

const buyTime = (h: Holding): number => new Date(h.buyDate!).getTime();

// Geometric interpolation from (buyT, basis) to (nowT, value): equal compounding per ms.
// Falls back to the basis when the value is non-positive (can't take a growth ratio).
function valueAt(t: number, buyT: number, nowT: number, basis: number, value: number): number {
  if (t <= buyT) return basis;
  if (t >= nowT || value <= 0 || nowT <= buyT) return value > 0 ? value : basis;
  const frac = (t - buyT) / (nowT - buyT);
  return basis * Math.pow(value / basis, frac);
}

// Sample times from the oldest real purchase to `endT` (exclusive-ish), ~monthly, capped.
export function basisSampleTimes(holdings: Holding[], endT: number, maxSamples = 80): number[] {
  const buys = holdings.filter(usable).map(buyTime).filter((t) => Number.isFinite(t) && t < endT);
  if (buys.length === 0) return [];
  const start = Math.min(...buys);
  const span = endT - start;
  const step = Math.max(7 * 86_400_000, span / maxSamples);
  const out: number[] = [];
  for (let t = start; t < endT; t += step) out.push(Math.round(t));
  return out;
}

// Per-account estimated values at each sample time — only real-basis holdings, each
// appearing at its buy date at cost and compounding toward today's value.
export function basisBandsByAccount(
  holdings: Holding[],
  accountIds: Set<string>,
  usdInr: number,
  times: number[],
  nowT = Date.now(),
): BasisBand[] {
  if (times.length === 0) return [];
  const byAccount = new Map<string, Holding[]>();
  for (const h of holdings) {
    if (!accountIds.has(h.accountId) || !usable(h)) continue;
    const list = byAccount.get(h.accountId) ?? [];
    list.push(h);
    byAccount.set(h.accountId, list);
  }
  const bands: BasisBand[] = [];
  for (const [accountId, hs] of byAccount) {
    const values = times.map((t) => {
      let sum = 0;
      for (const h of hs) {
        const bT = buyTime(h);
        if (t < bT) continue; // not bought yet
        sum += valueAt(t, bT, nowT, toBase(h.costBasis!, h.currency, usdInr), toBase(h.marketValue, h.currency, usdInr));
      }
      return Math.round(sum);
    });
    if (values.some((v) => v !== 0)) bands.push({ accountId, values });
  }
  return bands;
}
