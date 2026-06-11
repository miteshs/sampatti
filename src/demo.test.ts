// The demos' synthesized 18 months of history must be INTERNALLY consistent: the chart's
// last point equals today's authored portfolio, every late-joining account steps the record
// on its scheduled day with a matching flows-ledger event (to the rupee), and the trend
// card's growth/added/tracking split sums exactly to the recorded change. Both region demos
// run through the same invariants — DEMO_ENTERS/MOVERS are name-keyed and shared, so each
// portfolio checks against the subset of names it actually contains.
import { describe, expect, it } from "vitest";
import { demoPortfolio, DEMO_ENTERS, DEMO_HISTORY_DAYS } from "./demo";
import { snapshotOf, snapshotSeries, snapshotTime, todayLocal } from "./domain/snapshots";
import { flowsInWindow } from "./domain/flows";

const REGION_CASES = [
  {
    label: "India",
    p: demoPortfolio(),
    flatDayOne: ["Provident Fund", "Bank & Deposits", "Real Estate", "Home Loan"],
    movers: ["Zerodha Demat", "Equity Mutual Funds", "Gold"],
  },
  {
    label: "US",
    p: demoPortfolio("US"),
    flatDayOne: ["Old Employer 401(k) — Empower", "Mortgage"],
    movers: ["Schwab Taxable", "Fidelity 401(k)", "Vanguard Roth IRA"],
  },
];

const ageOf = (date: string) => Math.round((snapshotTime(todayLocal()) - snapshotTime(date)) / 86_400_000);

for (const { label, p, flatDayOne, movers } of REGION_CASES) {
  const acctId = (name: string) => p.accounts.find((a) => a.name === name)!.id;
  // The shared enter-schedule entries that exist in THIS portfolio.
  const enters = Object.entries(DEMO_ENTERS).filter(([name]) => p.accounts.some((a) => a.name === name));

  describe(`${label} demo recorded history`, () => {
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
      expect(demoPortfolio(p.settings.country).snapshots).toEqual(p.snapshots);
    });

    it("flat accounts stay flat; market accounts move", () => {
      const first = p.snapshots[0].accounts, last = p.snapshots[p.snapshots.length - 1].accounts;
      for (const name of flatDayOne) {
        expect(first[acctId(name)], name).toBe(last[acctId(name)]);
      }
      for (const name of movers) {
        expect(first[acctId(name)], name).not.toBe(last[acctId(name)]);
      }
    });

    it("every late joiner enters the record exactly on its scheduled day", () => {
      for (const [name, e] of enters) {
        const aid = acctId(name);
        for (const s of p.snapshots) {
          expect(aid in s.accounts, `${name} @ ${s.date}`).toBe(ageOf(s.date) <= e.daysAgo);
        }
      }
    });

    it("the flows ledger has one event per joiner, matching the snapshot step to the rupee", () => {
      expect(p.flows).toHaveLength(enters.length);
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
      // 18 months of drift on a serious book: real, positive, and plausible.
      expect(growth).toBeGreaterThan(0);
      expect(growth).toBeLessThan(recorded);
    });
  });
}
