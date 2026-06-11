import { describe, expect, it } from "vitest";
import { periodStart, priceAt, latestPrice, sampleDates, reconstruct, periodChange, type Series } from "./history";
import type { Account, Holding } from "./types";

const DAY = 86_400_000;
const acct = (id: string, accountType: Account["accountType"] = "demat"): Account => ({
  id, name: id, institution: "x", accountType, taxTreatment: "taxable", region: "India", currency: "INR",
});
const hold = (p: Partial<Holding>): Holding => ({
  id: "h", accountId: "a", name: "H", assetClass: "indian_equity", marketValue: 100, currency: "INR", ...p,
});

describe("periodStart", () => {
  it("YTD is Jan 1 of the current year", () => {
    const now = new Date("2026-06-09T12:00:00Z").getTime();
    expect(new Date(periodStart("YTD", now)).getMonth()).toBe(0);
    expect(new Date(periodStart("YTD", now)).getDate()).toBe(1);
  });
  it("'All' opens the window to the whole record", () => {
    expect(periodStart("All")).toBe(-Infinity);
  });
  it("1M / 1Y step back the expected amount", () => {
    const now = new Date("2026-06-09T00:00:00Z").getTime();
    expect(new Date(periodStart("1M", now)).getMonth()).toBe(4); // May
    expect(new Date(periodStart("1Y", now)).getFullYear()).toBe(2025);
  });
});

describe("priceAt / latestPrice", () => {
  const s: Series = [{ t: 0, price: 10 }, { t: DAY, price: 20 }, { t: 2 * DAY, price: 30 }];
  it("returns the price at-or-before t", () => {
    expect(priceAt(s, DAY)).toBe(20);
    expect(priceAt(s, DAY + 1)).toBe(20);
    expect(priceAt(s, -1)).toBeNull(); // before the series
  });
  it("latestPrice is the last point", () => expect(latestPrice(s)).toBe(30));
});

describe("sampleDates", () => {
  it("spans the window and always ends at now", () => {
    const now = 100 * DAY;
    const ds = sampleDates(0, now, 10);
    expect(ds[0]).toBe(0);
    expect(ds[ds.length - 1]).toBe(now);
    expect(ds.every((t, i) => i === 0 || t > ds[i - 1])).toBe(true);
  });
});

describe("reconstruct", () => {
  const accounts = [acct("a"), acct("loan", "liability")];
  // A holding worth 100 now whose price doubled over the window (was 50 at t=0).
  const series: Series = [{ t: 0, price: 50 }, { t: 10 * DAY, price: 100 }];

  it("scales a tracked holding by price(t)/price(now), anchored to current value", () => {
    const holdings = [hold({ id: "h1", accountId: "a", marketValue: 100 })];
    const pts = reconstruct(holdings, accounts, 1, () => series, [0, 10 * DAY]);
    expect(pts[0].netWorth).toBe(50); // half the current value at t=0
    expect(pts[1].netWorth).toBe(100); // current
  });

  it("carries untrackable holdings flat (resolver returns null)", () => {
    const holdings = [hold({ id: "h1", accountId: "a", assetClass: "real_estate", marketValue: 5000 })];
    const pts = reconstruct(holdings, accounts, 1, () => null, [0, 10 * DAY]);
    expect(pts.map((p) => p.netWorth)).toEqual([5000, 5000]);
  });

  it("subtracts liability accounts", () => {
    const holdings = [
      hold({ id: "h1", accountId: "a", marketValue: 100 }),
      hold({ id: "l1", accountId: "loan", assetClass: "other", marketValue: 30 }),
    ];
    const pts = reconstruct(holdings, accounts, 1, (h) => (h.accountId === "a" ? series : null), [10 * DAY]);
    expect(pts[0].netWorth).toBe(70); // 100 asset − 30 liability
  });

  it("converts USD holdings at the current rate", () => {
    const holdings = [hold({ id: "h1", accountId: "a", currency: "USD", marketValue: 100 })];
    const pts = reconstruct(holdings, accounts, 90, () => null, [0]);
    expect(pts[0].netWorth).toBe(9000);
  });
});

describe("periodChange", () => {
  it("computes abs and pct between first and last", () => {
    const c = periodChange([{ t: 0, netWorth: 100 }, { t: 1, netWorth: 150 }]);
    expect(c.abs).toBe(50);
    expect(c.pct).toBe(50);
  });
  it("is null pct with <2 points", () => expect(periodChange([{ t: 0, netWorth: 100 }]).pct).toBeNull());
});
