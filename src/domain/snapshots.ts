// Daily net-worth snapshots — the RECORDED history behind the trend chart (vs. history.ts,
// which RECONSTRUCTS the past from price series). A snapshot stores each account's INR value
// for one day (liabilities negative), so the chart can re-sum over whichever accounts are
// currently included without baking the include/exclude choice into the record. PURE module:
// the store decides when to record; this file only computes.

import { holdingBase } from "./format";
import type { NetWorthPoint } from "./history";
import type { DailySnapshot, Portfolio } from "./types";

export const MAX_SNAPSHOTS = 1500; // ~4 years of daily use

export function todayLocal(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Noon local time, so the chart's epoch-ms x-axis never lands a date on the previous/next
// day across DST or UTC conversions.
export const snapshotTime = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

// Today's per-account values for the FULL portfolio (excluded accounts too — visibility is
// applied at read time). Liability accounts are recorded negative so a plain sum = net worth.
export function snapshotOf(p: Portfolio, date = todayLocal()): DailySnapshot {
  const { usdInr } = p.settings;
  const accounts: Record<string, number> = {};
  const typeById = new Map(p.accounts.map((a) => [a.id, a.accountType]));
  for (const h of p.holdings) {
    const sign = typeById.get(h.accountId) === "liability" ? -1 : 1;
    accounts[h.accountId] = (accounts[h.accountId] ?? 0) + sign * holdingBase(h, usdInr);
  }
  for (const k of Object.keys(accounts)) accounts[k] = Math.round(accounts[k]);
  return { date, accounts };
}

// Insert or replace the snapshot for its date, keeping the list ascending and bounded.
// Returns true when the list actually changed (so callers can skip a pointless save).
export function upsertSnapshot(snapshots: DailySnapshot[], snap: DailySnapshot): boolean {
  const i = snapshots.findIndex((s) => s.date === snap.date);
  if (i >= 0) {
    const prev = snapshots[i];
    const same =
      Object.keys(prev.accounts).length === Object.keys(snap.accounts).length &&
      Object.entries(snap.accounts).every(([k, v]) => prev.accounts[k] === v);
    if (same) return false;
    snapshots[i] = snap;
    return true;
  }
  snapshots.push(snap);
  snapshots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
  return true;
}

// Aligned per-account value series for the stacked Performance chart. Days are the recorded
// snapshot days from `fromT` on; an account absent on a day (not yet tracked then) reads 0,
// so a newly added account rises out of the baseline exactly on its add-day. Accounts that
// are zero across the whole window are dropped.
export interface AccountSeries {
  accountId: string;
  values: number[]; // aligned with `times`
}

export function perAccountSeries(
  snapshots: DailySnapshot[],
  accountIds: Set<string>,
  fromT = -Infinity,
): { times: number[]; series: AccountSeries[] } {
  const days = snapshots.filter((s) => snapshotTime(s.date) >= fromT);
  const times = days.map((s) => snapshotTime(s.date));
  const series = [...accountIds]
    .map((accountId) => ({ accountId, values: days.map((s) => s.accounts[accountId] ?? 0) }))
    .filter((s) => s.values.some((v) => v !== 0));
  return { times, series };
}

// Recorded series over the currently-visible accounts, from `fromT` on. Deleted accounts drop
// out naturally (their id is in no visible set); same for excluded ones.
export function snapshotSeries(
  snapshots: DailySnapshot[],
  visibleAccountIds: Set<string>,
  fromT = -Infinity,
): NetWorthPoint[] {
  const out: NetWorthPoint[] = [];
  for (const s of snapshots) {
    const t = snapshotTime(s.date);
    if (t < fromT) continue;
    let nw = 0;
    for (const [id, v] of Object.entries(s.accounts)) if (visibleAccountIds.has(id)) nw += v;
    out.push({ t, netWorth: nw });
  }
  return out;
}

