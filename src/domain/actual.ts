// Actual-performance math over the RECORDED net-worth series (vs. history.ts, which
// simulates). Two tools, both pure:
//   • growthOnlySeries — the recorded curve with non-growth events (money in/out, coverage
//     changes, unattributable deltas) subtracted out, so it's apples-to-apples with the
//     market simulation: both then show market motion only.
//   • modifiedDietz — the standard money-weighted return over the window, so "your actual
//     return %" accounts for WHEN money was added, not just how much.
// Same event set and window semantics as flowsInWindow: an event on the window's first day
// is already inside that day's level → excluded; one on the last day is included.

import type { FlowEvent } from "./types";
import type { NetWorthPoint } from "./history";

// Visible, in-window events as (t, amount), ascending by t.
function eventTimes(
  flows: FlowEvent[],
  visibleAccountIds: Set<string>,
  fromT: number,
  toT: number,
  timeOf: (date: string) => number,
): { t: number; amount: number }[] {
  return flows
    .filter((f) => visibleAccountIds.has(f.accountId))
    .map((f) => ({ t: timeOf(f.date), amount: f.amount }))
    .filter((e) => e.t > fromT && e.t <= toT)
    .sort((a, b) => a.t - b.t);
}

// The recorded series minus cumulative event amounts up to each point — what the curve
// would look like if no money had been added/removed and no coverage had changed.
export function growthOnlySeries(
  points: NetWorthPoint[],
  flows: FlowEvent[],
  visibleAccountIds: Set<string>,
  timeOf: (date: string) => number,
): NetWorthPoint[] {
  if (points.length === 0) return [];
  const events = eventTimes(flows, visibleAccountIds, points[0].t, points[points.length - 1].t, timeOf);
  const out: NetWorthPoint[] = [];
  let cum = 0, i = 0;
  for (const p of points) {
    while (i < events.length && events[i].t <= p.t) cum += events[i++].amount;
    out.push({ t: p.t, netWorth: p.netWorth - cum });
  }
  return out;
}

// Modified Dietz money-weighted return over the recorded window, as a FRACTION (0.055 =
// +5.5%). Null when the window is degenerate or the weighted base isn't positive (e.g. a
// portfolio funded almost entirely mid-window — a % would be meaningless noise).
export function modifiedDietz(
  points: NetWorthPoint[],
  flows: FlowEvent[],
  visibleAccountIds: Set<string>,
  timeOf: (date: string) => number,
): number | null {
  if (points.length < 2) return null;
  const begin = points[0], end = points[points.length - 1];
  const span = end.t - begin.t;
  if (span <= 0) return null;
  const events = eventTimes(flows, visibleAccountIds, begin.t, end.t, timeOf);
  let totalFlow = 0, weighted = 0;
  for (const e of events) {
    totalFlow += e.amount;
    weighted += e.amount * ((end.t - e.t) / span);
  }
  const base = begin.netWorth + weighted;
  if (base <= 0) return null;
  return (end.netWorth - begin.netWorth - totalFlow) / base;
}
