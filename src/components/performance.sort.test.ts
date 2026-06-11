// @vitest-environment jsdom
// The P&L table's column sort, as pure logic: header cycling (text starts ascending,
// numeric descending), null-last in BOTH directions, and stable inputs.
import { describe, expect, it } from "vitest";
import { compareRows, nextColSort, type ColSort } from "./Performance";
import type { Holding } from "../domain/types";

const row = (name: string, value: number, gainPct: number | null, buyDate?: string) => ({
  h: { id: name, accountId: "a", name, assetClass: "indian_equity", marketValue: value, currency: "INR", buyDate } as Holding,
  a: undefined, value,
  g: gainPct == null ? null : { invested: value / 2, gain: value / 2, gainPct, estimated: false },
});

describe("nextColSort cycling", () => {
  it("numeric columns start descending, text columns ascending; same column toggles", () => {
    expect(nextColSort(null, "value")).toEqual({ col: "value", dir: "desc" });
    expect(nextColSort(null, "name")).toEqual({ col: "name", dir: "asc" });
    const d: ColSort = { col: "value", dir: "desc" };
    expect(nextColSort(d, "value")).toEqual({ col: "value", dir: "asc" });
    expect(nextColSort({ col: "value", dir: "asc" }, "value")).toEqual({ col: "value", dir: "desc" });
    expect(nextColSort(d, "gain")).toEqual({ col: "gain", dir: "desc" }); // switching column resets
  });
});

describe("compareRows", () => {
  const rows = [row("beta", 100, 5), row("alpha", 300, null), row("gamma", 200, -2)];

  it("sorts numerically with direction", () => {
    const desc = [...rows].sort(compareRows("value", "desc")).map((r) => r.h.name);
    expect(desc).toEqual(["alpha", "gamma", "beta"]);
    const asc = [...rows].sort(compareRows("value", "asc")).map((r) => r.h.name);
    expect(asc).toEqual(["beta", "gamma", "alpha"]);
  });

  it("sorts text columns alphabetically", () => {
    const asc = [...rows].sort(compareRows("name", "asc")).map((r) => r.h.name);
    expect(asc).toEqual(["alpha", "beta", "gamma"]);
  });

  it("rows without the value sink to the bottom in BOTH directions", () => {
    const desc = [...rows].sort(compareRows("gainPct", "desc")).map((r) => r.h.name);
    expect(desc).toEqual(["beta", "gamma", "alpha"]); // alpha has no basis → last
    const asc = [...rows].sort(compareRows("gainPct", "asc")).map((r) => r.h.name);
    expect(asc).toEqual(["gamma", "beta", "alpha"]); // still last
  });

  it("held sorts by time owned, undated last", () => {
    const dated = [row("old", 1, 1, "2019-01-01"), row("new", 1, 1, "2026-01-01"), row("none", 1, 1)];
    const desc = [...dated].sort(compareRows("held", "desc")).map((r) => r.h.name);
    expect(desc).toEqual(["old", "new", "none"]);
  });
});
