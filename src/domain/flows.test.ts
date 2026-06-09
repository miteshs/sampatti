import { describe, expect, it } from "vitest";
import { decomposeReplace, flowsInWindow, incomeOverWindow } from "./flows";
import { snapshotTime } from "./snapshots";
import type { FlowEvent, Holding, Income } from "./types";

const h = (over: Partial<Holding> & { name: string; marketValue: number }): Holding => ({
  id: "x", accountId: "a", assetClass: "indian_equity", currency: "INR", ...over,
});

describe("decomposeReplace — statement delta → flow vs growth(residual) vs unclassified", () => {
  it("price moved, units unchanged → pure growth (no flow, no unclassified)", () => {
    const d = decomposeReplace(
      [h({ name: "TCS", units: 10, marketValue: 1000 })],
      [h({ name: "TCS", units: 10, marketValue: 1200 })],
      95,
    );
    expect(d.flow).toBe(0);
    expect(d.unclassified).toBe(0);
  });

  it("bought more: Δunits × new price is flow; the price move stays growth", () => {
    // 10 @100 → 15 @120: ΔV=800 = growth 10×20=200 + flow 5×120=600
    const d = decomposeReplace(
      [h({ name: "TCS", units: 10, marketValue: 1000 })],
      [h({ name: "TCS", units: 15, marketValue: 1800 })],
      95,
    );
    expect(d.flow).toBe(600);
    expect(d.unclassified).toBe(0);
  });

  it("trimmed the position → negative flow at the new price", () => {
    const d = decomposeReplace(
      [h({ name: "TCS", units: 10, marketValue: 1000 })],
      [h({ name: "TCS", units: 6, marketValue: 720 })], // 6 @120
      95,
    );
    expect(d.flow).toBe(-480); // sold 4 × 120
  });

  it("a brand-new position is a buy; a vanished one is a sale", () => {
    const d = decomposeReplace(
      [h({ name: "OLD", marketValue: 500 })],
      [h({ name: "NEW", marketValue: 800 })],
      95,
    );
    expect(d.flow).toBe(300); // +800 bought, −500 sold
  });

  it("no units on either side → the delta is honestly unclassified", () => {
    const d = decomposeReplace(
      [h({ name: "PPF", marketValue: 1000 })],
      [h({ name: "PPF", marketValue: 1300 })],
      95,
    );
    expect(d.flow).toBe(0);
    expect(d.unclassified).toBe(300);
  });

  it("matches a renamed security by symbol and converts USD at the given rate", () => {
    const d = decomposeReplace(
      [h({ name: "Microsoft", symbol: "MSFT", units: 10, marketValue: 1000, currency: "USD" })],
      [h({ name: "MSFT CORP", symbol: "MSFT", units: 12, marketValue: 1320, currency: "USD" })], // 12 @110
      90,
    );
    expect(d.flow).toBe(2 * 110 * 90); // bought 2 shares, in INR
  });
});

describe("flowsInWindow", () => {
  const ev = (date: string, accountId: string, amount: number, kind: FlowEvent["kind"]): FlowEvent => ({
    id: date + accountId, date, accountId, amount, kind, source: "import",
  });
  const flows = [
    ev("2026-06-01", "a", 100, "flow"),
    ev("2026-06-05", "a", 200, "flow"),
    ev("2026-06-05", "b", 999, "flow"), // hidden account
    ev("2026-06-07", "a", 50, "tracking"),
    ev("2026-06-09", "a", -25, "unclassified"),
  ];
  const visible = new Set(["a"]);

  it("buckets by kind, honoring account visibility", () => {
    const f = flowsInWindow(flows, visible, snapshotTime("2026-05-31"), snapshotTime("2026-06-09"), snapshotTime);
    expect(f).toEqual({ flow: 300, tracking: 50, unclassified: -25 });
  });

  it("excludes events on the window's first day (already inside that day's level)", () => {
    const f = flowsInWindow(flows, visible, snapshotTime("2026-06-01"), snapshotTime("2026-06-09"), snapshotTime);
    expect(f.flow).toBe(200); // the 2026-06-01 event is part of the starting level
  });
});

describe("incomeOverWindow", () => {
  const income: Income[] = [
    { id: "1", source: "Salary", kind: "salary", amount: 100_000, frequency: "monthly", currency: "INR" },
    { id: "2", source: "Dividends", kind: "dividend", amount: 120_000, frequency: "annual", currency: "INR" },
  ];
  it("prorates the annualized total over the window", () => {
    expect(incomeOverWindow(income, 365, 95)).toBe(1_320_000);
    expect(incomeOverWindow(income, 73, 95)).toBe(264_000); // a fifth of the year
    expect(incomeOverWindow(income, 0, 95)).toBe(0);
  });
});
