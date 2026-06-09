// Growth-vs-flows decomposition (PURE — the store decides when to record, this file only
// computes). The recorded net-worth curve moves for three distinct reasons, and they must
// not contaminate each other:
//   growth   — prices moving on what was already held (NEVER stored; it's the residual)
//   flow     — the user's money entering/leaving (savings invested, withdrawals)
//   tracking — coverage changes (started/stopped tracking an existing asset)
// Plus "unclassified" when a statement delta can't be attributed (no units on either side).
//
// The key trick: a re-imported statement can be decomposed per matched holding when units
// are known:   ΔV = uₒ·(pₙ − pₒ)  +  (uₙ − uₒ)·pₙ
//                    └── growth ──┘   └──── flow ────┘
// where p = value/units on each side. Unmatched new holdings are buys; vanished ones are
// sells. Internal transfers net out at the portfolio level (sell stock +cash appears as
// −flow here, +flow there).

import { toBase } from "./format";
import type { FlowEvent, FlowKind, Holding, Income } from "./types";

type DraftHolding = Omit<Holding, "id" | "accountId">;

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

// Decompose a wholesale statement replacement into flow + unclassified (INR). Matching
// mirrors the basis carry-forward (symbol+name → symbol → name, each old holding consumed
// once) so the two passes agree on identity.
export function decomposeReplace(
  old: Holding[],
  next: DraftHolding[],
  usdInr: number,
): { flow: number; unclassified: number } {
  const used = new Set<Holding>();
  const matchOld = (h: DraftHolding): Holding | undefined => {
    const bySymName = old.find((o) => !used.has(o) && norm(o.symbol) === norm(h.symbol) && norm(o.name) === norm(h.name));
    if (bySymName) return bySymName;
    if (norm(h.symbol)) {
      const bySym = old.find((o) => !used.has(o) && norm(o.symbol) === norm(h.symbol));
      if (bySym) return bySym;
    }
    return old.find((o) => !used.has(o) && norm(o.name) === norm(h.name));
  };

  let flow = 0;
  let unclassified = 0;

  for (const h of next) {
    const o = matchOld(h);
    if (!o) {
      flow += toBase(h.marketValue, h.currency, usdInr); // new position = bought
      continue;
    }
    used.add(o);
    const sameCcy = (o.currency || "INR").toUpperCase() === (h.currency || "INR").toUpperCase();
    if (sameCcy && o.units && o.units > 0 && h.units && h.units > 0 && o.marketValue > 0) {
      // Units on both sides → split price movement (growth, implicit) from quantity change.
      const newPrice = h.marketValue / h.units;
      flow += toBase((h.units - o.units) * newPrice, h.currency, usdInr);
    } else {
      // No way to tell price from quantity → the whole delta is unclassified.
      unclassified += toBase(h.marketValue, h.currency, usdInr) - toBase(o.marketValue, o.currency, usdInr);
    }
  }
  for (const o of old) {
    if (!used.has(o)) flow -= toBase(o.marketValue, o.currency, usdInr); // vanished = sold
  }

  return { flow: Math.round(flow), unclassified: Math.round(unclassified) };
}

// Sum the events that explain the recorded curve between two snapshot times, honoring the
// same account-visibility rule as snapshotSeries. An event ON the window's first day is
// excluded (it's already inside that day's level), one on the last day is included.
export function flowsInWindow(
  flows: FlowEvent[],
  visibleAccountIds: Set<string>,
  fromT: number,
  toT: number,
  timeOf: (date: string) => number,
): Record<FlowKind, number> {
  const out: Record<FlowKind, number> = { flow: 0, tracking: 0, unclassified: 0 };
  for (const f of flows) {
    if (!visibleAccountIds.has(f.accountId)) continue;
    const t = timeOf(f.date);
    if (t <= fromT || t > toT) continue;
    out[f.kind] += f.amount;
  }
  return out;
}

// Declared income over a window (INR) — the DENOMINATOR for a savings rate. Flows are
// detected from statement diffs, never assumed from income.
export function incomeOverWindow(income: Income[], days: number, usdInr: number): number {
  if (days <= 0) return 0;
  let annual = 0;
  for (const inc of income) {
    annual += toBase((inc.frequency === "monthly" ? 12 : 1) * inc.amount, inc.currency, usdInr);
  }
  return Math.round((annual * days) / 365);
}
