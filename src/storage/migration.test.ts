// @vitest-environment jsdom
// DATA DURABILITY — the unforgivable-failure class. A portfolio file written by an old
// build must load losslessly forever: nothing dropped, every later-added field backfilled.
// The fixture below is frozen as a pre-snapshots/flows/edits, pre-cost-basis, pre-model
// file (the schema as it shipped earliest); if a future change breaks loading it, this
// test is the tripwire — never "fix" it by editing the fixture.
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./store";
import { emptyPortfolio, DEFAULT_RELAY_URL } from "../domain/types";
import { todayLocal } from "../domain/snapshots";

const LEGACY = {
  version: 1,
  accounts: [
    {
      id: "acc-1", name: "Old Demat", institution: "Some Broker", accountType: "demat",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2025-11-30",
    },
    {
      id: "acc-2", name: "Old Loan", institution: "Some Bank", accountType: "liability",
      taxTreatment: "na", region: "India", currency: "INR",
    },
  ],
  holdings: [
    { id: "h-1", accountId: "acc-1", name: "Legacy Stock", assetClass: "indian_equity", marketValue: 250000, currency: "INR" },
    { id: "h-2", accountId: "acc-1", name: "Legacy Fund", assetClass: "equity_mf", marketValue: 100000, currency: "INR" },
    { id: "h-3", accountId: "acc-2", name: "Loan outstanding", assetClass: "other", marketValue: 50000, currency: "INR" },
  ],
  income: [{ id: "i-1", source: "Salary", kind: "salary", amount: 100000, frequency: "monthly", currency: "INR" }],
  settings: {
    country: "India", baseCurrency: "INR", claudeMode: "relay", relayUrl: "", usdInr: 83, byoKeySet: false,
    // no analysisModel — added later
  },
  updatedAt: "2025-12-01T00:00:00.000Z",
  // no edits / snapshots / flows — all added later
};

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: false });
});

describe("legacy portfolio file migration", () => {
  it("loads an old-schema file losslessly and backfills every later field", async () => {
    localStorage.setItem("sampatti.portfolio", JSON.stringify(LEGACY));
    await useStore.getState().load();
    const p = useStore.getState().portfolio;

    // Nothing lost.
    expect(p.accounts.map((a) => a.name)).toEqual(["Old Demat", "Old Loan"]);
    expect(p.holdings).toHaveLength(3);
    expect(p.holdings.find((h) => h.id === "h-1")!.marketValue).toBe(250000);
    expect(p.income).toHaveLength(1);

    // Later-added structures backfilled.
    expect(Array.isArray(p.edits)).toBe(true);
    expect(Array.isArray(p.flows)).toBe(true);
    expect(p.settings.analysisModel).toBe(emptyPortfolio().settings.analysisModel);
    expect(p.settings.relayUrl).toBe(DEFAULT_RELAY_URL); // empty relayUrl backfilled
    expect(p.settings.usdInr).toBe(83); // user's own value NOT clobbered by defaults

    // Basis migration: every holding gains a cost basis, flagged as estimated.
    for (const h of p.holdings) {
      expect(h.costBasis, h.name).toBe(h.marketValue);
      expect(h.costBasisEstimated, h.name).toBe(true);
    }

    // Opening the file records today's snapshot (liability negative).
    const today = p.snapshots.find((s) => s.date === todayLocal());
    expect(today).toBeDefined();
    expect(today!.accounts["acc-1"]).toBe(350000);
    expect(today!.accounts["acc-2"]).toBe(-50000);

    // And the migrated file was persisted back (persist debounces 250ms — let it land).
    await new Promise((r) => setTimeout(r, 400));
    const saved = JSON.parse(localStorage.getItem("sampatti.portfolio")!);
    expect(saved.holdings[0].costBasisEstimated).toBe(true);
  });

  it("a corrupt file falls back to a clean start instead of hanging", async () => {
    localStorage.setItem("sampatti.portfolio", "{not json");
    await useStore.getState().load();
    expect(useStore.getState().loaded).toBe(true);
    expect(useStore.getState().portfolio.accounts).toHaveLength(0);
  });
});
