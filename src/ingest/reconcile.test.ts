// Cross-account duplicate detection (the CAS-overlap problem): same instrument in another
// account must be flagged; same instrument AND same size is an exact duplicate; the
// Apply-to target account is exempt (updating it is the point).
import { describe, expect, it } from "vitest";
import { findCrossAccountDuplicates } from "./reconcile";
import type { Account, Holding, ImportDraft } from "../domain/types";

const acct = (id: string, name: string): Account =>
  ({ id, name, institution: "X", accountType: "mutual_fund", taxTreatment: "taxable", region: "India", currency: "INR" } as Account);

const holding = (over: Partial<Holding>): Holding =>
  ({ id: Math.random().toString(), accountId: "a", name: "Fund", assetClass: "equity_mf", marketValue: 100, currency: "INR", ...over } as Holding);

const draftWith = (holdings: ImportDraft["holdings"]): ImportDraft => ({
  account: { name: "Mutual Funds — CAS", institution: "CAMS / KFintech", accountType: "mutual_fund", taxTreatment: "taxable", region: "India", currency: "INR" },
  holdings, warnings: [], source: "cas.pdf",
});

const accounts = [acct("a", "Groww Mutual Funds"), acct("b", "Coin")];

describe("findCrossAccountDuplicates", () => {
  it("flags an ISIN match in another account as exact when units agree", () => {
    const existing = [holding({ accountId: "a", symbol: "INF0AA0TEST1", units: 1405.01 })];
    const hits = findCrossAccountDuplicates(
      draftWith([{ name: "Some Flexi Cap", symbol: "INF0AA0TEST1", assetClass: "equity_mf", units: 1405.013, marketValue: 134178, currency: "INR" }]),
      existing, accounts,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ index: 0, accountName: "Groww Mutual Funds", exact: true });
  });

  it("same ISIN but a different size is flagged, NOT exact (could be a second folio)", () => {
    const existing = [holding({ accountId: "a", symbol: "INF0AA0TEST1", units: 500 })];
    const hits = findCrossAccountDuplicates(
      draftWith([{ name: "Fund", symbol: "INF0AA0TEST1", assetClass: "equity_mf", units: 1405, marketValue: 1, currency: "INR" }]),
      existing, accounts,
    );
    expect(hits[0].exact).toBe(false);
  });

  it("falls back to normalized-name matching when symbols are missing", () => {
    const existing = [holding({ accountId: "b", name: "Parag Parikh Flexi Cap Fund", marketValue: 100000 })];
    const hits = findCrossAccountDuplicates(
      draftWith([{ name: "parag parikh   flexi-cap fund", assetClass: "equity_mf", marketValue: 100100, currency: "INR" }]),
      existing, accounts,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].accountName).toBe("Coin");
    expect(hits[0].exact).toBe(true); // values 0.1% apart — same position
  });

  it("value tolerance decides exactness for unit-less holdings", () => {
    const existing = [holding({ accountId: "b", name: "Quux Fund", marketValue: 100000 })];
    const close = findCrossAccountDuplicates(
      draftWith([{ name: "Quux Fund", assetClass: "equity_mf", marketValue: 100500, currency: "INR" }]), existing, accounts);
    const far = findCrossAccountDuplicates(
      draftWith([{ name: "Quux Fund", assetClass: "equity_mf", marketValue: 150000, currency: "INR" }]), existing, accounts);
    expect(close[0].exact).toBe(true);
    expect(far[0].exact).toBe(false);
  });

  it("ignores the Apply-to target account and unrelated holdings", () => {
    const existing = [
      holding({ accountId: "a", symbol: "INF0AA0TEST1", units: 10 }),
      holding({ accountId: "b", name: "Unrelated Small Cap", symbol: "INF0ZZ0TEST9", units: 5 }),
    ];
    const hits = findCrossAccountDuplicates(
      draftWith([{ name: "Fund", symbol: "INF0AA0TEST1", assetClass: "equity_mf", units: 10, marketValue: 1, currency: "INR" }]),
      existing, accounts, "a",
    );
    expect(hits).toHaveLength(0);
  });
});
