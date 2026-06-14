import { describe, expect, it } from "vitest";
import { groupHoldings, instrumentKey } from "./aggregate";
import type { Account, Holding } from "./types";

const acct = (id: string, name: string, accountType: Account["accountType"] = "demat"): Account => ({
  id, name, institution: "", accountType, taxTreatment: "taxable", region: "India", currency: "INR",
});
const hold = (p: Partial<Holding> & { accountId: string }): Holding => ({
  id: Math.random().toString(36).slice(2), name: "X", assetClass: "indian_equity", marketValue: 0, currency: "INR", ...p,
});

describe("groupHoldings — club same instrument across accounts", () => {
  const accounts = [acct("z", "Zerodha"), acct("i", "ICICI")];

  it("merges the same symbol from two accounts into one row, summing value and listing accounts", () => {
    const holdings = [
      hold({ accountId: "z", symbol: "HDFCBANK", name: "HDFC Bank", marketValue: 100 }),
      hold({ accountId: "i", symbol: "HDFCBANK", name: "HDFC Bank", marketValue: 300 }),
    ];
    const g = groupHoldings(holdings, accounts, 90);
    expect(g).toHaveLength(1);
    expect(g[0].value).toBe(400);
    expect(g[0].legs).toBe(2);
    expect(g[0].accounts).toEqual(["ICICI", "Zerodha"]); // ordered by value desc
  });

  it("falls back to normalized name + class when there is no symbol; keeps a stock and a fund apart", () => {
    const holdings = [
      hold({ accountId: "z", name: "HDFC Bank ", marketValue: 100 }),
      hold({ accountId: "i", name: "hdfc bank", marketValue: 100 }),
      hold({ accountId: "z", name: "HDFC Bank", assetClass: "equity_mf", marketValue: 50 }),
    ];
    const g = groupHoldings(holdings, accounts, 90);
    expect(g).toHaveLength(2); // the two equities coalesce; the fund stays separate
    expect(g[0].value).toBe(200);
  });

  it("combines P&L over real-basis legs only (estimated bases excluded)", () => {
    const holdings = [
      hold({ accountId: "z", symbol: "X", marketValue: 150, costBasis: 100 }),                       // real: +50
      hold({ accountId: "i", symbol: "X", marketValue: 200, costBasis: 200, costBasisEstimated: true }), // estimated → ignored for gain
    ];
    const g = groupHoldings(holdings, accounts, 90);
    expect(g[0].value).toBe(350);             // value still totals both legs
    expect(g[0].gain?.invested).toBe(100);
    expect(g[0].gain?.gain).toBe(50);
    expect(g[0].gain?.gainPct).toBe(50);
  });

  it("symbol identity ignores case/whitespace", () => {
    expect(instrumentKey(hold({ accountId: "z", symbol: " hdfcbank " }))).toBe(instrumentKey(hold({ accountId: "i", symbol: "HDFCBANK" })));
  });
});
