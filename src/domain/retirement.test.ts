import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { projectRetirement } from "./retirement";

// A baseline mid-career case we can reason about by hand.
const base = {
  currentAge: 40,
  retireAge: 60,
  currentCorpus: 1_00_00_000, // ₹1 Cr
  monthlyContribution: 50_000,
  expectedReturnPct: 10,
  inflationPct: 6,
  desiredMonthlyIncome: 1_00_000, // ₹1L/month in today's money
};

describe("projectRetirement", () => {
  it("compounds corpus + contributions over the years to retirement", () => {
    const p = projectRetirement(base);
    expect(p.years).toBe(20);
    // FV of ₹1 Cr at 10% for 20y ≈ 6.727 Cr; FV of ₹50k/mo annuity ≈ 3.8 Cr → ~10.5 Cr.
    expect(p.projectedCorpus).toBeGreaterThan(9_00_00_000);
    expect(p.projectedCorpus).toBeLessThan(12_00_00_000);
  });

  it("requires more corpus when the desired income is inflated to the retirement year", () => {
    const p = projectRetirement(base);
    // ₹1L/mo today × 12 × 1.06^20 ≈ ₹38.5L/yr; /4% ≈ ₹9.6 Cr required.
    expect(p.desiredAnnualIncomeAtRetirement).toBeGreaterThan(38_00_000);
    expect(p.requiredCorpus).toBeGreaterThan(9_00_00_000);
    expect(p.requiredCorpus).toBeLessThan(10_00_00_000);
  });

  it("flags a clear shortfall as 'watch'", () => {
    const p = projectRetirement({ ...base, currentCorpus: 0, monthlyContribution: 5_000 });
    expect(p.coverageRatio).toBeLessThan(0.8);
    expect(p.tone).toBe("watch");
    expect(p.gap).toBeLessThan(0);
  });

  it("marks a well-funded plan 'good' with a surplus", () => {
    const p = projectRetirement({ ...base, currentCorpus: 5_00_00_000, monthlyContribution: 2_00_000 });
    expect(p.coverageRatio).toBeGreaterThanOrEqual(1);
    expect(p.tone).toBe("good");
    expect(p.gap).toBeGreaterThan(0);
  });

  it("handles already-at/over retirement age without blowing up (no negative years)", () => {
    const p = projectRetirement({ ...base, currentAge: 65, retireAge: 60 });
    expect(p.years).toBe(0);
    expect(p.projectedCorpus).toBe(base.currentCorpus); // no growth, no contributions
    expect(Number.isFinite(p.requiredCorpus)).toBe(true);
  });

  it("uses the 25× rule by default (4% withdrawal)", () => {
    const p = projectRetirement({ ...base, currentAge: 60, retireAge: 60, inflationPct: 0 });
    // desired ₹1L/mo → ₹12L/yr → /4% = ₹3 Cr required, no inflation, no growth.
    expect(p.requiredCorpus).toBeCloseTo(3_00_00_000, -3);
  });
});

describe("projectRetirement — invariants (fuzzed, seeded)", () => {
  const arb = fc.record({
    currentAge: fc.integer({ min: 18, max: 80 }),
    retireAge: fc.integer({ min: 18, max: 90 }),
    currentCorpus: fc.integer({ min: 0, max: 100_00_00_000 }),
    monthlyContribution: fc.integer({ min: 0, max: 10_00_000 }),
    expectedReturnPct: fc.double({ min: 0, max: 20, noNaN: true }),
    inflationPct: fc.double({ min: 0, max: 15, noNaN: true }),
    desiredMonthlyIncome: fc.integer({ min: 0, max: 50_00_000 }),
  });

  it("always produces finite, non-negative figures with years ≥ 0", () => {
    fc.assert(fc.property(arb, (i) => {
      const p = projectRetirement(i);
      expect(Number.isFinite(p.projectedCorpus) && p.projectedCorpus >= 0).toBe(true);
      expect(Number.isFinite(p.requiredCorpus) && p.requiredCorpus >= 0).toBe(true);
      expect(p.years).toBeGreaterThanOrEqual(0);
    }), { seed: 1991 });
  });

  it("more monthly contribution never lowers the projected corpus", () => {
    fc.assert(fc.property(arb, fc.integer({ min: 1, max: 5_00_000 }), (i, extra) => {
      const a = projectRetirement(i);
      const b = projectRetirement({ ...i, monthlyContribution: i.monthlyContribution + extra });
      expect(b.projectedCorpus).toBeGreaterThanOrEqual(a.projectedCorpus);
    }), { seed: 1991 });
  });

  it("the tone always agrees with the coverage ratio", () => {
    fc.assert(fc.property(arb, (i) => {
      const p = projectRetirement(i);
      if (p.coverageRatio >= 1) expect(p.tone).toBe("good");
      else if (p.coverageRatio >= 0.8) expect(p.tone).toBe("ok");
      else expect(p.tone).toBe("watch");
    }), { seed: 1991 });
  });
});
