// The demo's synthesized 18 months of history must be INTERNALLY consistent: the chart's
// last point equals today's authored portfolio, every late-joining account steps the record
// on its scheduled day with a matching flows-ledger event (to the rupee), and the trend
// card's growth/added/tracking split sums exactly to the recorded change.
import { describe, expect, it } from "vitest";
import { demoPortfolio, DEMO_ENTERS, DEMO_HISTORY_DAYS } from "./demo";
import { snapshotOf, snapshotSeries, snapshotTime, todayLocal } from "./domain/snapshots";
import { flowsInWindow } from "./domain/flows";

const p = demoPortfolio();
const acctId = (name: string) => p.accounts.find((a) => a.name === name)!.id;
const ageOf = (date: string) => Math.round((snapshotTime(todayLocal()) - snapshotTime(date)) / 86_400_000);

describe("demo recorded history", () => {
  it("covers the full span, ascending, ending today", () => {
    expect(p.snapshots.length).toBe(DEMO_HISTORY_DAYS + 1);
    const dates = p.snapshots.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[dates.length - 1]).toBe(todayLocal());
  });

  it("today's snapshot equals the authored portfolio account-for-account", () => {
    expect(p.snapshots[p.snapshots.length - 1].accounts).toEqual(snapshotOf(p).accounts);
  });

  it("is deterministic — two loads produce the same history", () => {
    expect(demoPortfolio().snapshots).toEqual(p.snapshots);
  });

  it("flat accounts stay flat; market accounts move", () => {
    const first = p.snapshots[0].accounts, last = p.snapshots[p.snapshots.length - 1].accounts;
    for (const name of ["Provident Fund", "Bank & Deposits", "Real Estate", "Home Loan"]) {
      expect(first[acctId(name)], name).toBe(last[acctId(name)]);
    }
    for (const name of ["Zerodha Demat", "Equity Mutual Funds", "Gold"]) {
      expect(first[acctId(name)], name).not.toBe(last[acctId(name)]);
    }
  });

  it("every late joiner enters the record exactly on its scheduled day", () => {
    for (const [name, e] of Object.entries(DEMO_ENTERS)) {
      const aid = acctId(name);
      for (const s of p.snapshots) {
        expect(aid in s.accounts, `${name} @ ${s.date}`).toBe(ageOf(s.date) <= e.daysAgo);
      }
    }
  });

  it("the flows ledger has one event per joiner, matching the snapshot step to the rupee", () => {
    expect(p.flows).toHaveLength(Object.keys(DEMO_ENTERS).length);
    for (const f of p.flows) {
      const day = p.snapshots.find((s) => s.date === f.date)!;
      expect(f.amount, f.label).toBe(day.accounts[f.accountId]);
      const name = p.accounts.find((a) => a.id === f.accountId)!.name;
      expect(f.kind).toBe(DEMO_ENTERS[name].kind);
    }
  });

  it("growth + added + tracking sums exactly to the recorded change (trend-card math)", () => {
    const visible = new Set(p.accounts.filter((a) => !a.excluded).map((a) => a.id));
    const pts = snapshotSeries(p.snapshots, visible);
    const recorded = pts[pts.length - 1].netWorth - pts[0].netWorth;
    const f = flowsInWindow(p.flows, visible, pts[0].t, pts[pts.length - 1].t, snapshotTime);
    const growth = recorded - f.flow - f.tracking - f.unclassified;
    const expectedTracking = p.flows
      .filter((x) => x.kind === "tracking" && visible.has(x.accountId))
      .reduce((s, x) => s + x.amount, 0);
    expect(f.tracking).toBe(expectedTracking);
    expect(f.flow).toBeGreaterThan(0);
    // 18 months of drift on a crore-scale book: real, positive, and plausible.
    expect(growth).toBeGreaterThan(0);
    expect(growth).toBeLessThan(recorded);
  });
});
