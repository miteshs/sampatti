// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "./store";
import { emptyPortfolio, type AccountType, type ImportDraft } from "../domain/types";

afterEach(() => {
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: false });
});

// Build a one-account import draft for upsert tests.
const draft = (name: string, institution: string, holdings: [string, number][]): ImportDraft => ({
  account: { name, institution, accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" },
  holdings: holdings.map(([n, v]) => ({ name: n, assetClass: "indian_equity", marketValue: v, currency: "INR" })),
  warnings: [],
  source: "test.csv",
});

describe("store load() — relay URL self-heal on upgrade", () => {
  it("backfills an empty relay URL from the current default", async () => {
    // A portfolio saved before the relay default existed stores relayUrl: "".
    const saved = emptyPortfolio();
    saved.settings.relayUrl = "";
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    const url = useStore.getState().portfolio.settings.relayUrl;
    expect(url).toBe(emptyPortfolio().settings.relayUrl);
    expect(url).toMatch(/^https:\/\//);
  });

  it("preserves a user-set custom relay URL", async () => {
    const saved = emptyPortfolio();
    saved.settings.relayUrl = "https://my-own-relay.workers.dev";
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    expect(useStore.getState().portfolio.settings.relayUrl).toBe("https://my-own-relay.workers.dev");
  });

  it("keeps newer saved settings while filling in any newly-added defaults", async () => {
    // Simulate an older save missing a field added later (analysisModel).
    const saved = emptyPortfolio() as unknown as Record<string, unknown>;
    (saved.settings as Record<string, unknown>).analysisModel = undefined;
    delete (saved.settings as Record<string, unknown>).analysisModel;
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    // The default model is filled in rather than left undefined.
    expect(useStore.getState().portfolio.settings.analysisModel).toBe(emptyPortfolio().settings.analysisModel);
  });
});

describe("store addDraft — re-import upserts an account in place", () => {
  it("replaces holdings of a matching account instead of duplicating it", () => {
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["RELIANCE", 300000], ["INFY", 100000]]));
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["RELIANCE", 500000]]));

    const p = useStore.getState().portfolio;
    expect(p.accounts.filter((a) => a.name === "Zerodha Demat")).toHaveLength(1);
    const acct = p.accounts.find((a) => a.name === "Zerodha Demat")!;
    const hs = p.holdings.filter((h) => h.accountId === acct.id);
    expect(hs).toHaveLength(1); // old two holdings dropped, replaced by the new one
    expect(hs[0].marketValue).toBe(500000);
    expect(p.holdings).toHaveLength(1); // no orphaned holdings left behind
  });

  it("matches case/whitespace-insensitively on institution + name", () => {
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["X", 1]]));
    useStore.getState().addDraft(draft("  zerodha demat ", "ZERODHA", [["Y", 2]]));
    expect(useStore.getState().portfolio.accounts).toHaveLength(1);
  });

  it("mode 'new' forces a separate account even when one matches", () => {
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["X", 1]]));
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["Y", 2]]), "new");
    expect(useStore.getState().portfolio.accounts).toHaveLength(2);
  });

  it("adds a genuinely different account alongside, not merged", () => {
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["X", 1]]));
    useStore.getState().addDraft(draft("HDFC Bank", "HDFC", [["FD", 5]]));
    expect(useStore.getState().portfolio.accounts).toHaveLength(2);
  });

  it("preserves the excluded flag and id when updating in place", () => {
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["X", 1]]));
    const id = useStore.getState().portfolio.accounts[0].id;
    useStore.getState().updateAccount(id, { excluded: true });
    useStore.getState().addDraft(draft("Zerodha Demat", "Zerodha", [["Y", 2]]));
    const acct = useStore.getState().portfolio.accounts[0];
    expect(acct.id).toBe(id);
    expect(acct.excluded).toBe(true);
  });
});

// A richer statement builder that carries an as-of date and lets type vary, to exercise the
// "import an updated statement for an existing account" flows the way real re-imports behave.
const stmt = (
  name: string, institution: string, holdings: [string, number][],
  opts: { asOf?: string; accountType?: AccountType } = {},
): ImportDraft => ({
  account: {
    name, institution, accountType: opts.accountType ?? "demat",
    taxTreatment: "taxable", region: "India", currency: "INR", asOf: opts.asOf,
  },
  holdings: holdings.map(([n, v]) => ({ name: n, assetClass: "indian_equity", marketValue: v, currency: "INR" })),
  warnings: [], source: "stmt.csv",
});

describe("statement update scenarios", () => {
  const s = () => useStore.getState();

  it("a newer statement adds new items and drops ones that are gone (sold/liquidated)", () => {
    s().addDraft(stmt("Schwab", "Schwab", [["AAPL", 100], ["MSFT", 50], ["TSLA", 30]], { asOf: "2026-01-01" }));
    // Next statement: TSLA sold, values changed, NVDA newly bought.
    s().addDraft(stmt("Schwab", "Schwab", [["AAPL", 120], ["MSFT", 60], ["NVDA", 80]], { asOf: "2026-06-01" }));

    const p = s().portfolio;
    expect(p.accounts).toHaveLength(1);
    const acct = p.accounts[0];
    const hs = p.holdings.filter((h) => h.accountId === acct.id);
    expect(hs.map((h) => h.name).sort()).toEqual(["AAPL", "MSFT", "NVDA"]); // TSLA gone, NVDA added
    expect(hs.find((h) => h.name === "AAPL")!.marketValue).toBe(120); // value refreshed
    expect(p.holdings.some((h) => h.name === "TSLA")).toBe(false); // fully removed — no orphan
    expect(acct.asOf).toBe("2026-06-01"); // metadata refreshed from the new statement
  });

  it("refreshes account metadata (type / as-of) on re-import while keeping the same id", () => {
    s().addDraft(stmt("ICICI", "ICICI", [["X", 1]], { asOf: "2026-01-01", accountType: "demat" }));
    const id = s().portfolio.accounts[0].id;
    s().addDraft(stmt("ICICI", "ICICI", [["X", 2]], { asOf: "2026-05-01", accountType: "bank" }));
    const a = s().portfolio.accounts[0];
    expect(a.id).toBe(id);
    expect(a.accountType).toBe("bank");
    expect(a.asOf).toBe("2026-05-01");
  });

  it("mergeDraftInto overwrites a user-chosen account that didn't auto-match (renamed statement)", () => {
    s().addDraft(stmt("Old Name", "Kotak", [["A", 10], ["B", 20]]));
    const id = s().portfolio.accounts[0].id;
    s().updateAccount(id, { excluded: true });
    // New statement labelled differently → no auto-match → the user points it at the account.
    s().mergeDraftInto(id, stmt("Kotak Securities 1234", "Kotak", [["A", 15], ["C", 30]], { asOf: "2026-06-01" }));

    const p = s().portfolio;
    expect(p.accounts).toHaveLength(1); // overwritten, not duplicated
    const a = p.accounts[0];
    expect(a.id).toBe(id);
    expect(a.excluded).toBe(true); // excluded flag preserved
    expect(a.name).toBe("Kotak Securities 1234"); // adopts the new statement's name/metadata
    const hs = p.holdings.filter((h) => h.accountId === id);
    expect(hs.map((h) => h.name).sort()).toEqual(["A", "C"]); // B dropped, C added
    expect(hs.find((h) => h.name === "A")!.marketValue).toBe(15);
  });

  it("a re-import never touches OTHER accounts' holdings", () => {
    s().addDraft(stmt("Zerodha", "Zerodha", [["RELIANCE", 100]]));
    s().addDraft(stmt("HDFC", "HDFC", [["FD", 200]]));
    s().addDraft(stmt("Zerodha", "Zerodha", [["RELIANCE", 150], ["TCS", 90]]));

    const p = s().portfolio;
    const hdfc = p.accounts.find((a) => a.name === "HDFC")!;
    expect(p.holdings.filter((h) => h.accountId === hdfc.id).map((h) => h.name)).toEqual(["FD"]); // untouched
    const z = p.accounts.find((a) => a.name === "Zerodha")!;
    expect(p.holdings.filter((h) => h.accountId === z.id)).toHaveLength(2);
  });

  it("mergeDraftInto a non-existent account is a safe no-op", () => {
    s().addDraft(stmt("A", "A", [["x", 1]]));
    const before = JSON.stringify(s().portfolio.holdings);
    s().mergeDraftInto("does-not-exist", stmt("B", "B", [["y", 2]]));
    expect(JSON.stringify(s().portfolio.holdings)).toBe(before);
    expect(s().portfolio.accounts).toHaveLength(1);
  });

  it("'Add as separate' (mode 'new') keeps both the old account and the updated statement", () => {
    s().addDraft(stmt("Demat", "Broker", [["A", 1]]));
    s().addDraft(stmt("Demat", "Broker", [["A", 2]]), "new");
    const p = s().portfolio;
    expect(p.accounts).toHaveLength(2);
    expect(p.holdings).toHaveLength(2);
  });
});

describe("store persistence across a restart", () => {
  it("saves committed data to disk and reloads it on next boot", async () => {
    const id = useStore.getState().addAccount({
      name: "Persist Co", institution: "X", accountType: "demat",
      taxTreatment: "taxable", region: "India", currency: "INR",
    });
    useStore.getState().addHolding({ accountId: id, name: "Stock", assetClass: "indian_equity", marketValue: 100000, currency: "INR" });

    await new Promise((r) => setTimeout(r, 320)); // wait out the debounced save
    expect(localStorage.getItem("sampatti.portfolio")).toContain("Persist Co");

    // Simulate a fresh launch: blank in-memory state, then load from disk.
    useStore.setState({ portfolio: emptyPortfolio(), loaded: false });
    await useStore.getState().load();

    const p = useStore.getState().portfolio;
    expect(p.accounts.some((a) => a.name === "Persist Co")).toBe(true);
    expect(p.holdings.some((h) => h.name === "Stock" && h.marketValue === 100000)).toBe(true);
  });
});
