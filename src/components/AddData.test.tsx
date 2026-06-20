// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio, type ImportDraft } from "../domain/types";

// Mock the ingest layer so we can feed AddData a controlled set of multi-account drafts
// without real files/parsing. classifyFile is steerable so the consent-gate tests can
// present text-PDF and image batches.
const { ingestFileMock, classifyMock, aiMock } = vi.hoisted(() => ({
  ingestFileMock: vi.fn(),
  classifyMock: vi.fn((_f: File): string => "local"),
  // Steerable engine state for the consent-gate tests (claude by default, like the app).
  aiMock: { engine: "claude" as "claude" | "local", ready: false },
}));
vi.mock("../ingest", () => ({
  classifyFile: classifyMock,
  isImportable: (f: File) => /\.(csv|pdf|png)$/i.test(f.name),
  ingestFile: ingestFileMock,
  ingestPdf: vi.fn(),
  ingestWithClaude: vi.fn(),
  NeedsClaudeError: class NeedsClaudeError extends Error {},
  PdfPasswordError: class PdfPasswordError extends Error {},
}));
vi.mock("../ai/engine", () => ({
  engineFor: () => aiMock.engine,
  localModelReady: async () => aiMock.ready,
  withExtractionEngine: async (_e: string, fn: () => Promise<unknown>) => fn(),
}));

import { AddData } from "./AddData";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
  ingestFileMock.mockReset();
  classifyMock.mockReset();
  classifyMock.mockImplementation(() => "local");
  aiMock.engine = "claude";
  aiMock.ready = false;
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

// ---- the engine-aware consent gate (docs/local-ai.md: consent-card flow) ----
// classify by extension: .pdf = AI-needed text, .png = image, else local.
const classifyByExt = (f: File) => (f.name.endsWith(".png") ? "ai-image" : f.name.endsWith(".pdf") ? "ai-text" : "local");

function pickFiles(...names: string[]) {
  const input = document.querySelector('input[type="file"][accept]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: names.map((n) => new File(["x"], n)) } });
}

describe("engine-aware consent gate", () => {
  it("claude engine: a text PDF still gates on the consent card (nothing runs unconfirmed)", async () => {
    classifyMock.mockImplementation(classifyByExt);
    render(<AddData />);
    pickFiles("stmt.pdf");
    expect(await screen.findByText(/Import 1 file\?/i)).toBeTruthy();
    expect(ingestFileMock).not.toHaveBeenCalled();
  });

  it("local engine + model ready: text PDFs parse immediately with NO 'sent to Claude' card", async () => {
    classifyMock.mockImplementation(classifyByExt);
    aiMock.engine = "local";
    aiMock.ready = true;
    ingestFileMock.mockResolvedValueOnce([draft("PMS Statement", [["Alpha PMS", 100]])]);
    render(<AddData />);
    pickFiles("stmt.pdf");
    await screen.findByText(/Review draft/i); // went straight to the review card
    expect(screen.queryByText(/Import 1 file\?/i)).toBeNull();
    expect(screen.queryByText(/going to Claude/i)).toBeNull();
    expect(ingestFileMock).toHaveBeenCalledTimes(1);
  });

  it("local engine + model ready: images still gate, listed as going to Claude", async () => {
    classifyMock.mockImplementation(classifyByExt);
    aiMock.engine = "local";
    aiMock.ready = true;
    render(<AddData />);
    pickFiles("scan.png", "holdings.csv");
    expect(await screen.findByText(/Import 2 files\?/i)).toBeTruthy();
    expect(screen.getByText(/the on-device model reads text only/i)).toBeTruthy();
    expect(ingestFileMock).not.toHaveBeenCalled();
  });

  it("local engine without the model: offers download-or-Claude, then full consent before sending", async () => {
    classifyMock.mockImplementation(classifyByExt);
    aiMock.engine = "local";
    aiMock.ready = false;
    ingestFileMock.mockResolvedValue([]);
    render(<AddData />);
    pickFiles("stmt.pdf");
    expect(await screen.findByText(/model isn't downloaded/i)).toBeTruthy();
    expect(ingestFileMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Use Claude this time/i }));
    // Choosing Claude still walks through the regular consent card — no silent send.
    expect(await screen.findByText(/Import 1 file\?/i)).toBeTruthy();
    expect(ingestFileMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Import 1 file/i }));
    await waitFor(() => expect(ingestFileMock).toHaveBeenCalledTimes(1));
  });

  it("shows the friendly AI access code modal when extraction fails with an auth error", async () => {
    classifyMock.mockImplementation(() => "ai-text");
    aiMock.engine = "claude";
    ingestFileMock.mockRejectedValueOnce(new Error("AI access code is missing or no longer working."));
    render(<AddData />);
    pickFiles("stmt.pdf");
    // Accept the batch
    fireEvent.click(await screen.findByRole("button", { name: /^Import 1 file/i }));
    // The friendly modal should appear instead of a generic red error
    expect(await screen.findByText(/AI access code issue/i)).toBeTruthy();
    expect(screen.getByText(/ask the developer for a new code/i)).toBeTruthy();
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
