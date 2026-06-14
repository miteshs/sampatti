import { describe, expect, it } from "vitest";
import { periodStart, latestPrice, periodChange, type Series } from "./history";

const DAY = 86_400_000;

describe("periodStart", () => {
  it("YTD is Jan 1 of the current year", () => {
    const now = new Date("2026-06-09T12:00:00Z").getTime();
    expect(new Date(periodStart("YTD", now)).getMonth()).toBe(0);
    expect(new Date(periodStart("YTD", now)).getDate()).toBe(1);
  });
  it("'All' opens the window to the whole record", () => {
    expect(periodStart("All")).toBe(-Infinity);
  });
  it("2Y and 5Y look back whole years", () => {
    const now = new Date("2026-06-10T12:00:00").getTime();
    expect(new Date(periodStart("2Y", now)).getFullYear()).toBe(2024);
    expect(new Date(periodStart("5Y", now)).getFullYear()).toBe(2021);
  });
  it("1M / 1Y step back the expected amount", () => {
    const now = new Date("2026-06-09T00:00:00Z").getTime();
    expect(new Date(periodStart("1M", now)).getMonth()).toBe(4); // May
    expect(new Date(periodStart("1Y", now)).getFullYear()).toBe(2025);
  });
});

describe("latestPrice", () => {
  const s: Series = [{ t: 0, price: 10 }, { t: DAY, price: 20 }, { t: 2 * DAY, price: 30 }];
  it("is the last point of an ascending series", () => expect(latestPrice(s)).toBe(30));
  it("is null for an empty series", () => expect(latestPrice([])).toBeNull());
});

describe("periodChange", () => {
  it("computes abs and pct between first and last", () => {
    const c = periodChange([{ t: 0, netWorth: 100 }, { t: 1, netWorth: 150 }]);
    expect(c.abs).toBe(50);
    expect(c.pct).toBe(50);
  });
  it("is null pct with <2 points", () => expect(periodChange([{ t: 0, netWorth: 100 }]).pct).toBeNull());
});
