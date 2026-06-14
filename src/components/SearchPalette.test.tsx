// @vitest-environment jsdom
// Cmd-F search palette: filters holdings by name / ticker / account / class, and a click
// surfaces the holding (opens Holdings + closes).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio, type Account, type Holding } from "../domain/types";
import { SearchPalette } from "./SearchPalette";

const acct = (id: string, name: string): Account => ({ id, name, institution: "", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" });
const hold = (p: Partial<Holding> & { id: string; accountId: string }): Holding => ({ name: "X", assetClass: "indian_equity", marketValue: 0, currency: "INR", ...p });

beforeEach(() => {
  const p = emptyPortfolio();
  p.accounts = [acct("z", "Zerodha"), acct("i", "ICICI Direct")];
  p.holdings = [
    hold({ id: "1", accountId: "z", name: "Infosys", symbol: "INFY", assetClass: "indian_equity", marketValue: 500000 }),
    hold({ id: "2", accountId: "i", name: "HDFC Bank", symbol: "HDFCBANK", assetClass: "indian_equity", marketValue: 300000 }),
    hold({ id: "3", accountId: "z", name: "Parag Parikh Flexi Cap", assetClass: "equity_mf", marketValue: 800000 }),
  ];
  useStore.setState({ portfolio: p, loaded: true, focusHoldingId: null });
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("SearchPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SearchPalette open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("filters by holding name", () => {
    render(<SearchPalette open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "infos" } });
    expect(screen.getByText("Infosys")).toBeTruthy();
    expect(screen.queryByText("HDFC Bank")).toBeNull();
  });

  it("filters by ticker", () => {
    render(<SearchPalette open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "hdfcbank" } });
    expect(screen.getByText("HDFC Bank")).toBeTruthy();
    expect(screen.queryByText("Infosys")).toBeNull();
  });

  it("filters by account name", () => {
    render(<SearchPalette open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "icici" } });
    expect(screen.getByText("HDFC Bank")).toBeTruthy();
    expect(screen.queryByText("Infosys")).toBeNull();
  });

  it("shows 'No matches' for a miss, and nothing for an empty query", () => {
    render(<SearchPalette open onClose={() => {}} />);
    expect(screen.queryByText(/No matches/)).toBeNull(); // empty query → no list, no message
    fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "zzzzz" } });
    expect(screen.getByText(/No matches/)).toBeTruthy();
  });

  it("clicking a result sets the focus signal and closes", () => {
    const onClose = vi.fn();
    render(<SearchPalette open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "infosys" } });
    fireEvent.click(screen.getByText("Infosys"));
    expect(useStore.getState().focusHoldingId).toBe("1"); // App then scrolls/flashes this row
    expect(onClose).toHaveBeenCalled();
  });
});
