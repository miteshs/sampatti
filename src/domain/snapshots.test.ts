import { describe, expect, it } from "vitest";
import { snapshotOf, snapshotSeries, snapshotTime, upsertSnapshot } from "./snapshots";
import { emptyPortfolio, type DailySnapshot, type Holding } from "./types";

function portfolioWith(): ReturnType<typeof emptyPortfolio> {
  const p = emptyPortfolio();
  p.settings.usdInr = 90;
  p.accounts = [
    { id: "a1", name: "Demat", institution: "Z", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" },
    { id: "a2", name: "US", institution: "S", accountType: "foreign_broker", taxTreatment: "taxable", region: "US", currency: "USD" },
    { id: "loan", name: "Home loan", institution: "H", accountType: "liability", taxTreatment: "na", region: "India", currency: "INR" },
    { id: "hidden", name: "Old", institution: "X", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR", excluded: true },
  ];
  const h = (id: string, accountId: string, marketValue: number, currency = "INR"): Holding => ({
    id, accountId, name: id, assetClass: "indian_equity", marketValue, currency,
  });
  p.holdings = [
    h("h1", "a1", 100_000), h("h2", "a1", 50_000),
    h("h3", "a2", 1_000, "USD"),
    h("debt", "loan", 40_000),
    h("hx", "hidden", 9_999),
  ];
  return p;
}

describe("snapshotOf", () => {
  const snap = snapshotOf(portfolioWith(), "2026-06-09");

  it("sums per account in INR at the day's rate", () => {
    expect(snap.accounts.a1).toBe(150_000);
    expect(snap.accounts.a2).toBe(90_000); // 1000 USD × 90
  });
  it("records liabilities negative so a plain sum is net worth", () => {
    expect(snap.accounts.loan).toBe(-40_000);
  });
  it("includes EXCLUDED accounts (visibility is applied at read time)", () => {
    expect(snap.accounts.hidden).toBe(9_999);
  });
});

describe("upsertSnapshot", () => {
  it("replaces the same day in place and reports change", () => {
    const list: DailySnapshot[] = [];
    expect(upsertSnapshot(list, { date: "2026-06-08", accounts: { a: 1 } })).toBe(true);
    expect(upsertSnapshot(list, { date: "2026-06-08", accounts: { a: 2 } })).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].accounts.a).toBe(2);
  });
  it("returns false when the day's values are identical (no pointless save)", () => {
    const list: DailySnapshot[] = [{ date: "2026-06-08", accounts: { a: 1 } }];
    expect(upsertSnapshot(list, { date: "2026-06-08", accounts: { a: 1 } })).toBe(false);
  });
  it("keeps the list ascending by date", () => {
    const list: DailySnapshot[] = [];
    upsertSnapshot(list, { date: "2026-06-09", accounts: {} });
    upsertSnapshot(list, { date: "2026-06-07", accounts: {} });
    upsertSnapshot(list, { date: "2026-06-08", accounts: {} });
    expect(list.map((s) => s.date)).toEqual(["2026-06-07", "2026-06-08", "2026-06-09"]);
  });
});

describe("snapshotSeries", () => {
  const snaps: DailySnapshot[] = [
    { date: "2026-06-01", accounts: { a: 100, b: 50, loan: -30 } },
    { date: "2026-06-05", accounts: { a: 120, b: 50, loan: -28 } },
  ];

  it("sums only the visible accounts", () => {
    const pts = snapshotSeries(snaps, new Set(["a", "loan"]));
    expect(pts.map((p) => p.netWorth)).toEqual([70, 92]);
  });
  it("drops deleted/never-visible accounts from the whole curve", () => {
    const pts = snapshotSeries(snaps, new Set(["a"]));
    expect(pts.map((p) => p.netWorth)).toEqual([100, 120]);
  });
  it("respects the fromT lower bound", () => {
    const pts = snapshotSeries(snaps, new Set(["a", "b", "loan"]), snapshotTime("2026-06-03"));
    expect(pts).toHaveLength(1);
    expect(pts[0].netWorth).toBe(142);
  });
});
