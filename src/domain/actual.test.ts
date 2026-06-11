import { describe, expect, it } from "vitest";
import { growthOnlySeries, modifiedDietz } from "./actual";
import type { FlowEvent } from "./types";
import type { NetWorthPoint } from "./history";

// Dates are plain numbers-as-strings; timeOf=Number keeps the math transparent.
const timeOf = Number;
const pt = (t: number, v: number): NetWorthPoint => ({ t, netWorth: v });
const ev = (date: number, amount: number, kind: FlowEvent["kind"] = "flow", accountId = "a"): FlowEvent =>
  ({ id: String(date), date: String(date), accountId, amount, kind, source: "manual" });

const VIS = new Set(["a"]);

describe("growthOnlySeries", () => {
  it("subtracts a mid-window inflow from every later point (step removed)", () => {
    const points = [pt(0, 100), pt(1, 100), pt(2, 150), pt(3, 152)];
    const flows = [ev(2, 50)];
    expect(growthOnlySeries(points, flows, VIS, timeOf).map((p) => p.netWorth)).toEqual([100, 100, 100, 102]);
  });

  it("ignores events on the window's first day (already inside that level)", () => {
    const points = [pt(1, 100), pt(2, 101)];
    expect(growthOnlySeries(points, [ev(1, 50)], VIS, timeOf).map((p) => p.netWorth)).toEqual([100, 101]);
  });

  it("subtracts tracking and unclassified too — growth means market motion only", () => {
    const points = [pt(0, 100), pt(1, 180)];
    const flows = [ev(1, 50, "tracking"), ev(1, 20, "unclassified")];
    expect(growthOnlySeries(points, flows, VIS, timeOf).map((p) => p.netWorth)).toEqual([100, 110]);
  });

  it("honors account visibility and handles outflows", () => {
    const points = [pt(0, 100), pt(1, 60)];
    const flows = [ev(1, -50), ev(1, 999, "flow", "hidden")];
    expect(growthOnlySeries(points, flows, VIS, timeOf).map((p) => p.netWorth)).toEqual([100, 110]);
  });
});

describe("modifiedDietz", () => {
  it("no flows → simple return", () => {
    expect(modifiedDietz([pt(0, 100), pt(10, 110)], [], VIS, timeOf)).toBeCloseTo(0.1, 10);
  });

  it("weights a mid-window inflow by time invested", () => {
    // V0=100, +100 exactly mid-window, Vend=210: gain=10 on base 100 + 100·0.5 → 6.67%.
    const r = modifiedDietz([pt(0, 100), pt(10, 210)], [ev(5, 100)], VIS, timeOf);
    expect(r).toBeCloseTo(10 / 150, 10);
  });

  it("an outflow shrinks the weighted base", () => {
    // V0=200, −100 mid-window, Vend=105: gain=5 on base 200 − 100·0.5 → ~3.33%.
    const r = modifiedDietz([pt(0, 200), pt(10, 105)], [ev(5, -100)], VIS, timeOf);
    expect(r).toBeCloseTo(5 / 150, 10);
  });

  it("degenerate windows and non-positive bases → null", () => {
    expect(modifiedDietz([pt(0, 100)], [], VIS, timeOf)).toBeNull();
    expect(modifiedDietz([pt(0, 0), pt(10, 50)], [ev(10, 50)], VIS, timeOf)).toBeNull();
  });
});
