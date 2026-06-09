import { describe, expect, it } from "vitest";
import { demoPortfolio } from "../demo";
import { buildBrief } from "./brief";

describe("buildBrief on the demo HNI portfolio", () => {
  const b = buildBrief(demoPortfolio());

  it("computes a net worth in the expected HNI range (~₹11–13 Cr)", () => {
    expect(b.netWorth).toBeGreaterThan(11_00_00_000);
    expect(b.netWorth).toBeLessThan(13_00_00_000);
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
    // Zomato + ESPP were bought recently → short-term; the rest long-term.
    expect(b.holdingPeriods.equityShortTerm).toBeGreaterThan(0);
    expect(b.holdingPeriods.equityLongTerm).toBeGreaterThan(b.holdingPeriods.equityShortTerm);
  });

  it("tracks EEE (PPF/EPF) and NPS wrapper coverage", () => {
    expect(b.taxWrappers.exemptEEE).toBe(45_00_000 + 28_00_000);
    expect(b.taxWrappers.nps).toBe(22_00_000);
  });

  it("summarizes annual income", () => {
    expect(b.income.annualTotal).toBe(600_000 * 12 + 45_000 * 12 + 300_000);
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
