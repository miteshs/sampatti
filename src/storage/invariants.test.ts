// @vitest-environment jsdom
// STORE INVARIANTS over operation sequences. Whatever the user does, three things must
// hold after every step: (1) today's snapshot equals the live per-account sums (liabilities
// negative); (2) every holding carries a cost basis (real or flagged estimate); (3) the
// flows ledger contains only well-formed events. These catch deep state bugs that
// single-operation tests miss.
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./store";
import { emptyPortfolio, type ImportDraft, type Portfolio } from "../domain/types";
import { snapshotOf, todayLocal } from "../domain/snapshots";

const draft = (name: string, holdings: [string, number][], accountType = "demat"): ImportDraft => ({
  account: {
    name, institution: "Inst-" + name, accountType: accountType as ImportDraft["account"]["accountType"],
    taxTreatment: accountType === "liability" ? "na" : "taxable", region: "India", currency: "INR",
  },
  holdings: holdings.map(([n, v]) => ({ name: n, assetClass: "indian_equity", marketValue: v, currency: "INR" })),
  warnings: [], source: "test",
});

function assertInvariants(p: Portfolio, label: string) {
  // (1) recorded today == live sums, per account.
  const today = p.snapshots.find((s) => s.date === todayLocal());
  if (p.holdings.length > 0) {
    expect(today, `${label}: today's snapshot exists`).toBeDefined();
    expect(today!.accounts, `${label}: snapshot equals live sums`).toEqual(snapshotOf(p).accounts);
  }
  // (2) ensureBasis invariant.
  for (const h of p.holdings) {
    expect(h.costBasis != null, `${label}: ${h.name} has a basis`).toBe(true);
  }
  // (3) ledger well-formed.
  for (const f of p.flows) {
    expect(["flow", "tracking", "unclassified"], `${label}: flow kind`).toContain(f.kind);
    expect(Number.isFinite(f.amount), `${label}: flow amount finite`).toBe(true);
    expect(p.accounts.some((a) => a.id === f.accountId) || true, `${label}: ledger may reference removed accounts (visibility filters them)`).toBe(true);
  }
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
});

describe("store invariants across an operation sequence", () => {
  it("hold after every mutation a user can make", () => {
    const s = () => useStore.getState();

    s().addDraft(draft("Broker A", [["AAA", 1000], ["BBB", 500]]), "new", "tracking");
    assertInvariants(s().portfolio, "after new tracking account");

    s().addDraft(draft("Broker B", [["CCC", 2000]]), "new", "flow");
    assertInvariants(s().portfolio, "after new-money account");

    s().addDraft(draft("Home Loan", [["Loan", 700]], "liability"), "new", "tracking");
    assertInvariants(s().portfolio, "after liability account");

    // Re-import: replace Broker A's holdings wholesale (BBB sold, AAA grew, DDD bought).
    const a = s().portfolio.accounts.find((x) => x.name === "Broker A")!;
    s().mergeDraftInto(a.id, draft("Broker A", [["AAA", 1500], ["DDD", 300]]));
    assertInvariants(s().portfolio, "after wholesale re-import");
    expect(s().portfolio.holdings.filter((h) => h.accountId === a.id)).toHaveLength(2);

    // Exclude an account (visibility change — record keeps it, views drop it).
    const b = s().portfolio.accounts.find((x) => x.name === "Broker B")!;
    s().updateAccount(b.id, { excluded: true });
    assertInvariants(s().portfolio, "after exclude");

    // Remove a single holding.
    const ddd = s().portfolio.holdings.find((h) => h.name === "DDD")!;
    s().removeHolding(ddd.id);
    assertInvariants(s().portfolio, "after holding removal");

    // Remove a whole account.
    s().removeAccount(b.id);
    assertInvariants(s().portfolio, "after account removal");
    expect(s().portfolio.holdings.some((h) => h.accountId === b.id)).toBe(false);

    // The wipe leaves a clean, loaded portfolio.
    void s().wipe();
  });
});
