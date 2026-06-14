// @vitest-environment jsdom
// Editing a (non-liability) account exposes a remaining loan/mortgage field that find-or-creates
// a paired "<account> — loan" liability, and clears it when set to 0.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio, type Account } from "../domain/types";
import { AccountEditor } from "./AccountEditor";

let acctId: string;
const loanAcct = (): Account | undefined =>
  useStore.getState().portfolio.accounts.find((a) => a.accountType === "liability" && a.name === "Mumbai flat — loan");

beforeEach(() => {
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
  acctId = useStore.getState().addAccount({ name: "Mumbai flat", institution: "", accountType: "real_estate", taxTreatment: "taxable", region: "India", currency: "INR" });
  useStore.getState().addHolding({ name: "Flat value", assetClass: "real_estate", marketValue: 10_000_000, currency: "INR", accountId: acctId });
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("AccountEditor — remaining loan", () => {
  it("creates a paired liability with the entered amount on blur", () => {
    render(<AccountEditor accountId={acctId} onClose={() => {}} />);
    const input = screen.getByLabelText("Remaining loan / mortgage");
    fireEvent.change(input, { target: { value: "2500000" } });
    fireEvent.blur(input);
    const la = loanAcct();
    expect(la).toBeTruthy();
    const holdings = useStore.getState().portfolio.holdings.filter((h) => h.accountId === la!.id);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].marketValue).toBe(2_500_000);
  });

  it("removes the liability when the loan is cleared to 0", () => {
    render(<AccountEditor accountId={acctId} onClose={() => {}} />);
    const input = screen.getByLabelText("Remaining loan / mortgage");
    fireEvent.change(input, { target: { value: "2500000" } });
    fireEvent.blur(input);
    expect(loanAcct()).toBeTruthy();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(loanAcct()).toBeUndefined();
  });
});
