import { describe, expect, it } from "vitest";
import { bandFor, portfolioHealth } from "./health";

describe("portfolioHealth", () => {
  it("scores an all-comfortable portfolio in the top band", () => {
    // equity 40% (good) · top-10 30% (good) · liquid 30% (good) → 100
    const h = portfolioHealth({ equityPct: 40, top10Pct: 30, liquidPct: 30 });
    expect(h.score).toBe(100);
    expect(h.band.key).toBe("strong");
  });

  it("matches the demo profile: concentration drags 'great' down to 'healthy'", () => {
    // equity 38% (good=100·.3) · top-10 55% (watch=45·.4) · liquid 48% (good=100·.3) = 78
    const h = portfolioHealth({ equityPct: 38, top10Pct: 55, liquidPct: 48 });
    expect(h.score).toBe(78);
    expect(h.band.key).toBe("healthy");
  });

  it("flags a fragile portfolio (over-concentrated + illiquid) for attention", () => {
    // equity 80% (watch=45·.3) · top-10 75% (watch=45·.4) · liquid 5% (watch=45·.3) = 45
    const h = portfolioHealth({ equityPct: 80, top10Pct: 75, liquidPct: 5 });
    expect(h.score).toBe(45);
    expect(h.band.key).toBe("attention");
  });

  it("never disagrees with its components — each tone is one of the three verdicts", () => {
    const h = portfolioHealth({ equityPct: 15, top10Pct: 40, liquidPct: 15 });
    expect(h.components.map((c) => c.label)).toEqual([
      "Stock-market exposure",
      "Concentration",
      "Liquidity",
    ]);
    for (const c of h.components) expect(["good", "ok", "watch"]).toContain(c.tone);
    // weights sum to 1 so the score stays on a clean 0–100 scale
    expect(h.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
  });

  it("bands cover the whole range at the documented cutoffs", () => {
    expect(bandFor(100).key).toBe("strong");
    expect(bandFor(85).key).toBe("strong");
    expect(bandFor(84).key).toBe("healthy");
    expect(bandFor(70).key).toBe("healthy");
    expect(bandFor(69).key).toBe("building");
    expect(bandFor(55).key).toBe("building");
    expect(bandFor(54).key).toBe("attention");
    expect(bandFor(0).key).toBe("attention");
  });
});
