// The demo's synthesized month of history must be INTERNALLY consistent: the chart's last
// point equals today's authored portfolio, account events step the record on the right day,
// and the flows ledger matches those steps to the rupee (so growth/added/tracking sums
// exactly to the recorded change on the trend card).
import { describe, expect, it } from "vitest";
import { demoPortfolio, DEMO_HISTORY_DAYS, DEMO_MF_DAYS_AGO, DEMO_PLOT_DAYS_AGO } from "./demo";
import { snapshotOf, snapshotSeries, snapshotTime, todayLocal } from "./domain/snapshots";
import { flowsInWindow } from "./domain/flows";

const p = demoPortfolio();
const acctId = (name: string) => p.accounts.find((a) => a.name === name)!.id;

describe("demo recorded history", () => {
  it("covers a full month, ascending, ending today", () => {
    expect(p.snapshots.length).toBe(DEMO_HISTORY_DAYS + 1);
    const dates = p.snapshots.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[dates.length - 1]).toBe(todayLocal());
  });

  it("today's snapshot equals the authored portfolio account-for-account", () => {
    const expected = snapshotOf(p).accounts;
    const last = p.snapshots[p.snapshots.length - 1].accounts;
    expect(last).toEqual(expected);
  });

  it("is deterministic — two loads produce the same history", () => {
    const q = demoPortfolio();
    expect(q.snapshots).toEqual(p.snapshots);
  });

  it("flat accounts stay flat; market accounts move", () => {
    const first = p.snapshots[0].accounts, last = p.snapshots[p.snapshots.length - 1].accounts;
    for (const name of ["Provident Fund", "Bank & Deposits", "Real Estate", "Marcellus PMS", "Home Loan"]) {
      expect(first[acctId(name)], name).toBe(last[acctId(name)]);
    }
    for (const name of ["Zerodha Demat", "Equity Mutual Funds", "Crypto Wallet"]) {
      expect(first[acctId(name)], name).not.toBe(last[acctId(name)]);
    }
  });

  it("the new accounts enter the record on their add-day, not before", () => {
    const groww = acctId("Groww Mutual Funds"), plot = acctId("Plot — Alibaug");
    for (const s of p.snapshots) {
      const age = Math.round((snapshotTime(todayLocal()) - snapshotTime(s.date)) / 86_400_000);
      expect(groww in s.accounts, `groww @ ${s.date}`).toBe(age <= DEMO_MF_DAYS_AGO);
      expect(plot in s.accounts, `plot @ ${s.date}`).toBe(age <= DEMO_PLOT_DAYS_AGO);
    }
  });

  it("the flows ledger matches the snapshot steps to the rupee", () => {
    expect(p.flows).toHaveLength(2);
    const flow = p.flows.find((f) => f.kind === "flow")!;
    const tracking = p.flows.find((f) => f.kind === "tracking")!;
    const onDay = (date: string, aid: string) => p.snapshots.find((s) => s.date === date)!.accounts[aid];
    expect(flow.amount).toBe(onDay(flow.date, flow.accountId));
    expect(tracking.amount).toBe(onDay(tracking.date, tracking.accountId));
    expect(tracking.amount).toBe(5_800_000); // the plot is flat — tracked at its full value
  });

  it("growth + added + tracking sums exactly to the recorded change (trend-card math)", () => {
    const visible = new Set(p.accounts.filter((a) => !a.excluded).map((a) => a.id));
    const pts = snapshotSeries(p.snapshots, visible);
    const recorded = pts[pts.length - 1].netWorth - pts[0].netWorth;
    const f = flowsInWindow(p.flows, visible, pts[0].t, pts[pts.length - 1].t, snapshotTime);
    const growth = recorded - f.flow - f.tracking - f.unclassified;
    expect(f.flow).toBeGreaterThan(0);
    expect(f.tracking).toBe(5_800_000);
    // The residual is market drift of the live accounts — believable, not absurd.
    expect(growth).toBeGreaterThan(0);
    expect(growth).toBeLessThan(recorded);
  });
});
