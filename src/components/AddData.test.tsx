// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio, type ImportDraft } from "../domain/types";

// Mock the ingest layer so we can feed AddData a controlled set of multi-account drafts
// without real files/parsing.
const { ingestFileMock } = vi.hoisted(() => ({ ingestFileMock: vi.fn() }));
vi.mock("../ingest", () => ({
  classifyFile: () => "local",
  isImportable: (f: File) => f.name.endsWith(".csv"),
  ingestFile: ingestFileMock,
  ingestPdf: vi.fn(),
  ingestWithClaude: vi.fn(),
  NeedsClaudeError: class NeedsClaudeError extends Error {},
  PdfPasswordError: class PdfPasswordError extends Error {},
}));

import { AddData } from "./AddData";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
  ingestFileMock.mockReset();
});

const draft = (name: string, holdings: [string, number][]): ImportDraft => ({
  account: { name, institution: "US Broker", accountType: "foreign_broker", taxTreatment: "taxable", region: "US", currency: "USD" },
  holdings: holdings.map(([n, v]) => ({ name: n, assetClass: "us_equity", marketValue: v, currency: "USD" })),
  warnings: [], source: "stmt.csv",
});

function importDrafts(drafts: ImportDraft[]) {
  ingestFileMock.mockResolvedValueOnce(drafts);
  const input = document.querySelector('input[type="file"][accept]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "stmt.csv", { type: "text/csv" })] } });
}

describe("re-import keeps accounts straight (stable draft keys)", () => {
  it("applying one matched draft doesn't reassign another's target → no duplicate / no cross-merge", async () => {
    // Two existing accounts A and B.
    useStore.getState().addDraft(draft("Acct A", [["AAA", 100]]));
    useStore.getState().addDraft(draft("Acct B", [["BBB", 200]]));

    render(<AddData />);
    // Re-import the SAME two accounts with new values.
    importDrafts([draft("Acct A", [["AAA", 111]]), draft("Acct B", [["BBB", 222]])]);

    // Both cards auto-match → preselected to Update ("Replace with …").
    const apply = await screen.findAllByRole("button", { name: /Replace with/i });
    expect(apply).toHaveLength(2);

    fireEvent.click(apply[0]); // commit the first card
    const remaining = await screen.findAllByRole("button", { name: /Replace with/i });
    expect(remaining).toHaveLength(1);
    fireEvent.click(remaining[0]); // commit the second card

    const p = useStore.getState().portfolio;
    expect(p.accounts).toHaveLength(2); // no duplicate created
    const a = p.accounts.find((x) => x.name === "Acct A")!;
    const b = p.accounts.find((x) => x.name === "Acct B")!;
    // Each account updated to its OWN new statement value (not cross-merged).
    expect(p.holdings.filter((h) => h.accountId === a.id).map((h) => h.marketValue)).toEqual([111]);
    expect(p.holdings.filter((h) => h.accountId === b.id).map((h) => h.marketValue)).toEqual([222]);
  });
});

describe("cross-account duplicate reconciliation (the CAS-overlap problem)", () => {
  it("flags draft holdings that already exist in another account and removes exact dupes on click", async () => {
    // Existing account holds AAA with units 100.
    useStore.getState().addDraft({
      ...draft("Groww MF", []),
      holdings: [{ name: "Alpha Flexi Cap", symbol: "INF0AA0TEST1", assetClass: "equity_mf", units: 100, marketValue: 1000, currency: "INR" }],
    });

    render(<AddData />);
    // A CAS-like draft arrives with the SAME instrument at the same size + one new fund.
    importDrafts([{
      ...draft("Mutual Funds — CAS", []),
      account: { ...draft("Mutual Funds — CAS", []).account, institution: "CAMS / KFintech" },
      holdings: [
        { name: "Alpha Flexi Cap Fund", symbol: "INF0AA0TEST1", assetClass: "equity_mf", units: 100, marketValue: 1000, currency: "INR" },
        { name: "Beta Midcap Fund", symbol: "INF0BB0TEST2", assetClass: "equity_mf", units: 50, marketValue: 500, currency: "INR" },
      ],
    }]);

    // Banner + row badge name the other account; the one-click removal drops the exact dupe.
    expect(await screen.findByText(/double-count/i)).toBeTruthy();
    expect(screen.getAllByText(/also in Groww MF/i).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Remove 1 exact duplicate/i }));
    expect(screen.queryByText(/also in Groww MF/i)).toBeNull();
    expect(screen.queryByText(/double-count/i)).toBeNull(); // banner gone too
    // The unique fund survived in the draft card.
    expect(screen.getByDisplayValue("Beta Midcap Fund")).toBeTruthy();
  });
});
