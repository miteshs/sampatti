import { describe, expect, it } from "vitest";
import {
  visiblePortfolio, accountKey, findMatchingAccount,
  emptyPortfolio, type Account, type Holding, type Portfolio,
} from "./types";
import { buildBrief } from "./brief";

function make(): Portfolio {
  const p = emptyPortfolio();
  const a1: Account = { id: "a1", name: "Zerodha Demat", institution: "Zerodha", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" };
  const a2: Account = { id: "a2", name: "US Broker", institution: "Morgan Stanley", accountType: "foreign_broker", taxTreatment: "taxable", region: "US", currency: "USD", excluded: true };
  p.accounts = [a1, a2];
  p.holdings = [
    { id: "h1", accountId: "a1", name: "Reliance", assetClass: "indian_equity", marketValue: 1_000_000, currency: "INR" } as Holding,
    { id: "h2", accountId: "a2", name: "MSFT", assetClass: "us_equity", marketValue: 50_000, currency: "USD" } as Holding,
  ];
  return p;
}

describe("visiblePortfolio (include/exclude filter)", () => {
  it("drops excluded accounts and their holdings", () => {
    const v = visiblePortfolio(make());
    expect(v.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(v.holdings.map((h) => h.id)).toEqual(["h1"]);
  });

  it("returns the same object when nothing is excluded (cheap no-op)", () => {
    const p = make();
    p.accounts[1].excluded = false;
    expect(visiblePortfolio(p)).toBe(p);
  });

  it("net worth reflects only included accounts", () => {
    const full = make();
    full.accounts[1].excluded = false;
    const briefFull = buildBrief(full);
    const briefVisible = buildBrief(visiblePortfolio(make())); // a2 excluded
    expect(briefVisible.netWorth).toBe(1_000_000); // only the INR account
    expect(briefVisible.netWorth).toBeLessThan(briefFull.netWorth);
  });
});

describe("account identity matching (upsert key)", () => {
  it("normalizes institution + name, case/space-insensitive", () => {
    expect(accountKey({ institution: " Zerodha ", name: "Demat A/C" }))
      .toBe(accountKey({ institution: "zerodha", name: "demat a/c" }));
  });

  it("finds a matching account regardless of case/whitespace", () => {
    const accts = make().accounts;
    expect(findMatchingAccount(accts, { institution: "ZERODHA", name: " zerodha demat " })?.id).toBe("a1");
    expect(findMatchingAccount(accts, { institution: "Unknown", name: "Nope" })).toBeUndefined();
  });
});
