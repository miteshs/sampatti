import { describe, expect, it } from "vitest";
import { basisBandsByAccount, basisSampleTimes } from "./basisHistory";
import type { Holding } from "./types";

const DAY = 86_400_000;
const NOW = new Date("2026-06-10T12:00:00Z").getTime();

const h = (over: Partial<Holding>): Holding =>
  ({ id: Math.random().toString(), accountId: "a", name: "x", assetClass: "indian_equity", marketValue: 200, currency: "INR", ...over } as Holding);

describe("basisSampleTimes", () => {
  it("spans from the oldest REAL purchase to the record start", () => {
    const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
    const times = basisSampleTimes([h({ costBasis: 100, buyDate: old })], NOW - 100 * DAY);
    expect(times.length).toBeGreaterThan(5);
    expect(times[0]).toBe(new Date(old).getTime());
    expect(times[times.length - 1]).toBeLessThan(NOW - 100 * DAY);
  });

  it("estimated bases and basis-less holdings contribute no era at all", () => {
    const old = new Date(NOW - 400 * DAY).toISOString().slice(0, 10);
    expect(basisSampleTimes([h({ buyDate: old })], NOW)).toEqual([]); // no basis
    expect(basisSampleTimes([h({ costBasis: 100, costBasisEstimated: true, buyDate: old })], NOW)).toEqual([]);
    expect(basisSampleTimes([h({ costBasis: 100 })], NOW)).toEqual([]); // no buy date
  });
});

describe("basisBandsByAccount", () => {
  const buyT = NOW - 1000 * DAY;
  const buy = new Date(buyT).toISOString().slice(0, 10);

  it("anchors at cost on the buy date and compounds geometrically toward today", () => {
    const holding = h({ costBasis: 100, marketValue: 400, buyDate: buy });
    const mid = buyT + 500 * DAY;
    const [band] = basisBandsByAccount([holding], new Set(["a"]), 1, [buyT, mid], NOW);
    expect(band.values[0]).toBe(100); // at purchase, worth what was paid
    expect(band.values[1]).toBeCloseTo(200, -1); // geometric midpoint of 100→400 ≈ 200
  });

  it("a holding bought later than a sample time contributes 0 there (no invented past)", () => {
    const late = h({ costBasis: 100, marketValue: 150, buyDate: new Date(NOW - 10 * DAY).toISOString().slice(0, 10) });
    const [band] = basisBandsByAccount([late], new Set(["a"]), 1, [NOW - 100 * DAY, NOW - 5 * DAY], NOW);
    expect(band.values[0]).toBe(0);
    expect(band.values[1]).toBeGreaterThan(0);
  });

  it("groups by account, converts USD, and drops invisible accounts", () => {
    const usd = h({ accountId: "b", costBasis: 1, marketValue: 2, currency: "USD", buyDate: buy });
    const bands = basisBandsByAccount([usd, h({ accountId: "hidden", costBasis: 5, buyDate: buy })], new Set(["a", "b"]), 90, [buyT], NOW);
    expect(bands).toHaveLength(1);
    expect(bands[0].accountId).toBe("b");
    expect(bands[0].values[0]).toBe(90); // $1 at ₹90
  });
});
