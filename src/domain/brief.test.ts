import { describe, expect, it } from "vitest";
import { demoPortfolio } from "../demo";
import { buildBrief } from "./brief";

describe("buildBrief on the demo HNI portfolio", () => {
  const b = buildBrief(demoPortfolio());

  it("computes a net worth in the expected HNI range (~₹12.5–14.5 Cr)", () => {
    expect(b.netWorth).toBeGreaterThan(12_50_00_000);
    expect(b.netWorth).toBeLessThan(14_50_00_000);
  });

  it("net worth = assets − liabilities", () => {
    expect(b.netWorth).toBe(b.totalAssets - b.totalLiabilities);
    expect(b.totalLiabilities).toBe(65_00_000); // the home loan
  });

  it("asset-class allocation percentages sum to ~100", () => {
    const sum = b.allocationByClass.reduce((s, a) => s + a.percent, 0);
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThan(101);
  });

  it("converts USD RSUs into the INR base at the manual rate", () => {
    // 85,000 USD * 95 should land in liquid + us_equity allocation.
    const us = b.allocationByClass.find((a) => a.label === "US Equity");
    expect(us).toBeDefined();
    expect(us!.value).toBeCloseTo(85_000 * 95, -3);
  });

  it("surfaces single-stock concentration metrics", () => {
    expect(b.concentration.topHoldings.length).toBeGreaterThan(0);
    expect(b.concentration.largestPctOfLiquid).toBeGreaterThan(0);
    expect(b.concentration.hhi).toBeGreaterThan(0);
  });

  it("splits taxable equity into STCG/LTCG buckets using buy dates", () => {
    // Trent + the SBI Small Cap re-entry + ESPP were bought recently → short-term; rest long-term.
    expect(b.holdingPeriods.equityShortTerm).toBeGreaterThan(0);
    expect(b.holdingPeriods.equityLongTerm).toBeGreaterThan(b.holdingPeriods.equityShortTerm);
  });

  it("tracks EEE (PPF/EPF) and NPS wrapper coverage", () => {
    expect(b.taxWrappers.exemptEEE).toBe(45_00_000 + 28_00_000);
    expect(b.taxWrappers.nps).toBe(22_00_000);
  });

  it("summarizes annual income", () => {
    expect(b.income.annualTotal).toBe(600_000 * 12 + 45_000 * 12 + 300_000 + 300_000 + 120_000);
  });
});

describe("brief privacy contract — only aggregates + top names leave the device", () => {
  const p = demoPortfolio();
  const b = buildBrief(p);
  const json = JSON.stringify(b);

  it("never serializes raw per-holding fields (units / buyDate / costBasis / symbol)", () => {
    for (const field of ['"units"', '"buyDate"', '"costBasis"', '"symbol"']) {
      expect(json).not.toContain(field);
    }
  });

  it("caps the disclosed holdings at the top 10 by value", () => {
    expect(p.holdings.length).toBeGreaterThan(10); // demo has many holdings
    expect(b.concentration.topHoldings.length).toBeLessThanOrEqual(10);
  });

  it("does not embed the full holdings or accounts arrays", () => {
    const bag = b as unknown as Record<string, unknown>;
    expect(bag.holdings).toBeUndefined();
    expect(bag.accounts).toBeUndefined();
  });
});

describe("brief gains block (cost basis)", () => {
  const b = buildBrief(demoPortfolio());

  it("totals invested cost and unrealized gain across holdings with a basis", () => {
    expect(b.gains.totalCostBasis).toBeGreaterThan(0);
    expect(b.gains.unrealizedGain).toBeGreaterThan(0); // demo is net up
    expect(b.gains.unrealizedPct).toBeGreaterThan(0);
  });

  it("reports what share of asset value has a REAL purchase cost", () => {
    // Demo has real bases on equities/MFs/gold/PMS but none on EPF/FD/cash/real estate.
    expect(b.gains.realBasisPct).toBeGreaterThan(20);
    expect(b.gains.realBasisPct).toBeLessThan(80);
  });

  it("notes that estimated bases must not drive tax math when coverage is low", () => {
    expect(b.notes.join(" ")).toMatch(/since first import/i);
  });

  it("adds gainPct to top holdings that have a real basis", () => {
    const mf = b.concentration.topHoldings.find((h) => h.name === "Mirae Asset Large Cap Fund");
    expect(mf?.gainPct).toBeCloseTo(87.5, 1); // (45L − 24L) / 24L
    // The PMS deliberately has NO reported cost (estimated anchor) → no gainPct for the AI.
    const pms = b.concentration.topHoldings.find((h) => h.name === "Consistent Compounders Portfolio");
    expect(pms?.gainPct).toBeUndefined();
    const flat = b.concentration.topHoldings.find((h) => h.name === "Primary residence — Mumbai");
    expect(flat?.gainPct).toBeUndefined(); // no basis on file
  });
});

describe("USD-base brief — outbound conversion at the edge (docs/regions.md unit rule)", () => {
  it("divides every monetary field by the rate; percentages and counts pass through", () => {
    const inrP = demoPortfolio();
    const usdP = demoPortfolio();
    usdP.settings.country = "US";
    usdP.settings.baseCurrency = "USD";
    const rate = usdP.settings.usdInr;

    const a = buildBrief(inrP);
    const b = buildBrief(usdP);

    expect(b.baseCurrency).toBe("USD");
    // Rounded division, not a re-computation — the internal INR math is shared.
    expect(b.netWorth).toBe(Math.round(a.netWorth / rate));
    expect(b.totalLiabilities).toBe(Math.round(a.totalLiabilities / rate));
    expect(b.gains.totalCostBasis).toBe(Math.round(a.gains.totalCostBasis / rate));
    expect(b.concentration.topHoldings[0].value).toBe(Math.round(a.concentration.topHoldings[0].value / rate));
    expect(b.income.annualTotal).toBe(Math.round(a.income.annualTotal / rate));
    // Unitless fields are untouched.
    expect(b.liquidPct).toBe(a.liquidPct);
    expect(b.concentration.hhi).toBe(a.concentration.hhi);
    expect(b.gains.unrealizedPct).toBe(a.gains.unrealizedPct);
    expect(b.concentration.topHoldings[0].pctOfAssets).toBe(a.concentration.topHoldings[0].pctOfAssets);
  });

  it("the FX note flips direction with the base", () => {
    const usdP = demoPortfolio();
    usdP.settings.country = "US";
    usdP.settings.baseCurrency = "USD";
    const note = buildBrief(usdP).notes.find((n) => n.includes("converted"));
    expect(note).toContain("Non-USD holdings converted");
  });
});
