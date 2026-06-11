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

  it("a pre-developer-mode save loads with the switch OFF (experimental stays invisible)", async () => {
    const saved = emptyPortfolio() as unknown as Record<string, unknown>;
    delete (saved.settings as Record<string, unknown>).developerMode;
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    expect(useStore.getState().portfolio.settings.developerMode).toBe(false);
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

describe("manual-edit trail", () => {
  const s = () => useStore.getState();
  const seed = () => {
    const aid = s().addAccount({ name: "Demat", institution: "Z", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" });
    const hid = s().addHolding({ accountId: aid, name: "RELIANCE", assetClass: "indian_equity", marketValue: 1000, currency: "INR" });
    return { aid, hid };
  };

  it("records a holding asset-class change with readable from → to", () => {
    const { hid } = seed();
    s().editHolding(hid, { assetClass: "private_equity" });
    expect(s().portfolio.edits).toHaveLength(1);
    expect(s().portfolio.edits[0]).toMatchObject({
      entity: "holding", entityId: hid, field: "asset class", from: "Indian Equity", to: "Private Equity",
    });
  });

  it("records an account field change with a readable label", () => {
    const { aid } = seed();
    s().editAccount(aid, { taxTreatment: "eee_exempt" });
    expect(s().portfolio.edits.find((e) => e.entity === "account")).toMatchObject({ field: "tax", to: "Tax-free (EEE)" });
  });

  it("logs nothing when the value is unchanged", () => {
    const { hid } = seed();
    s().editHolding(hid, { assetClass: "indian_equity" }); // same value
    expect(s().portfolio.edits).toHaveLength(0);
  });

  it("does NOT log programmatic updates (live-price refresh / exclude toggle)", () => {
    const { aid, hid } = seed();
    s().updateHolding(hid, { marketValue: 2000 }); // a price refresh
    s().updateAccount(aid, { excluded: true }); // include/exclude toggle
    expect(s().portfolio.edits).toHaveLength(0);
  });

  it("clearEdits empties the trail but keeps the data", () => {
    const { hid } = seed();
    s().editHolding(hid, { marketValue: 5000 });
    expect(s().portfolio.edits.length).toBeGreaterThan(0);
    s().clearEdits();
    expect(s().portfolio.edits).toHaveLength(0);
    expect(s().portfolio.holdings.find((h) => h.id === hid)!.marketValue).toBe(5000);
  });
});

describe("wipe clears ALL local data (no residue)", () => {
  it("removes the portfolio AND every sampatti.* cache (e.g. net-worth history)", async () => {
    useStore.getState().addDraft(stmt("X", "Y", [["A", 1]]));
    // Simulate the net-worth price-history cache + a stray future cache.
    localStorage.setItem("sampatti.nwhistory.v1", JSON.stringify({ fetchedAt: "x", data: {} }));
    localStorage.setItem("sampatti.someFutureCache", "junk");
    await new Promise((r) => setTimeout(r, 300)); // let the debounced portfolio save land

    await useStore.getState().wipe();

    expect(useStore.getState().portfolio.accounts).toHaveLength(0);
    expect(useStore.getState().portfolio.edits).toHaveLength(0);
    expect(localStorage.getItem("sampatti.portfolio")).toBeNull();
    expect(localStorage.getItem("sampatti.nwhistory.v1")).toBeNull();
    expect(localStorage.getItem("sampatti.someFutureCache")).toBeNull();
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

// ---- cost basis: since-import fallback + carry-forward across re-imports ----

// Draft builder with full per-holding control (basis/units/dates), for the basis tests.
const basisDraft = (
  name: string,
  holdings: (Partial<ImportDraft["holdings"][number]> & { name: string; marketValue: number })[],
): ImportDraft => ({
  account: { name, institution: "Inst", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" },
  holdings: holdings.map((h) => ({ assetClass: "indian_equity", currency: "INR", ...h })),
  warnings: [],
  source: "test.csv",
});

describe("cost basis — since-import fallback", () => {
  const s = () => useStore.getState();

  it("fills a missing basis with the current value, flagged estimated", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 18000 }]));
    const h = s().portfolio.holdings[0];
    expect(h.costBasis).toBe(18000);
    expect(h.costBasisEstimated).toBe(true);
  });

  it("keeps a real statement basis untouched (no estimated flag)", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 18000, costBasis: 12000 }]));
    const h = s().portfolio.holdings[0];
    expect(h.costBasis).toBe(12000);
    expect(h.costBasisEstimated).toBeFalsy();
  });

  it("migrates basis-less holdings of an old saved file on load()", async () => {
    const saved = emptyPortfolio() as unknown as { holdings: unknown[]; accounts: unknown[]; snapshots?: unknown };
    saved.accounts = [{ id: "a", name: "Old", institution: "X", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" }];
    saved.holdings = [{ id: "h", accountId: "a", name: "Legacy", assetClass: "indian_equity", marketValue: 5000, currency: "INR" }];
    delete saved.snapshots; // pre-snapshots file shape
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    const h = useStore.getState().portfolio.holdings[0];
    expect(h.costBasis).toBe(5000);
    expect(h.costBasisEstimated).toBe(true);
    expect(Array.isArray(useStore.getState().portfolio.snapshots)).toBe(true);
  });
});

describe("cost basis — carry-forward when a re-import lacks it", () => {
  const s = () => useStore.getState();

  it("carries a REAL basis and buy date into the re-imported holding", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 18000, costBasis: 12000, buyDate: "2022-02-15" }]));
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 19500 }])); // fresh statement, no cost column
    const h = s().portfolio.holdings[0];
    expect(s().portfolio.holdings).toHaveLength(1);
    expect(h.marketValue).toBe(19500);
    expect(h.costBasis).toBe(12000);
    expect(h.costBasisEstimated).toBeFalsy();
    expect(h.buyDate).toBe("2022-02-15");
  });

  it("carries the since-import anchor, scaled when the position size changed", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 10000, units: 10 }])); // anchor 10000 (est)
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 24000, units: 20 }])); // doubled position
    const h = s().portfolio.holdings[0];
    expect(h.costBasis).toBe(20000); // 10000 × 20/10
    expect(h.costBasisEstimated).toBe(true);
  });

  it("a statement that DOES carry a basis wins over the old anchor", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 10000 }]));
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 11000, costBasis: 9000 }]));
    const h = s().portfolio.holdings[0];
    expect(h.costBasis).toBe(9000);
    expect(h.costBasisEstimated).toBeFalsy();
  });

  it("matches by symbol when the statement renames the security", () => {
    s().addDraft(basisDraft("Demat", [{ name: "Tata Consultancy", symbol: "TCS", marketValue: 10000, costBasis: 7000 }]));
    s().addDraft(basisDraft("Demat", [{ name: "TCS LTD", symbol: "TCS", marketValue: 12000 }]));
    expect(s().portfolio.holdings[0].costBasis).toBe(7000);
  });

  it("does NOT carry anything between different securities", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 10000, costBasis: 7000 }]));
    s().addDraft(basisDraft("Demat", [{ name: "INFY", marketValue: 5000 }]));
    const h = s().portfolio.holdings[0];
    expect(h.name).toBe("INFY");
    expect(h.costBasis).toBe(5000); // fresh anchor, not TCS's 7000
    expect(h.costBasisEstimated).toBe(true);
  });
});

describe("daily net-worth snapshots", () => {
  const s = () => useStore.getState();

  it("records today's per-account snapshot on every commit (liabilities negative)", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 100000 }]));
    const loanDraft: ImportDraft = {
      account: { name: "Loan", institution: "Bank", accountType: "liability", taxTreatment: "na", region: "India", currency: "INR" },
      holdings: [{ name: "Home loan", assetClass: "other", marketValue: 40000, currency: "INR" }],
      warnings: [], source: "test",
    };
    s().addDraft(loanDraft);

    const snaps = s().portfolio.snapshots;
    expect(snaps).toHaveLength(1); // same day → one entry, refreshed in place
    const total = Object.values(snaps[0].accounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(60000); // 100000 − 40000
  });

  it("does not record while the portfolio is empty", () => {
    s().updateSettings({ usdInr: 90 });
    expect(s().portfolio.snapshots).toHaveLength(0);
  });
});

describe("flows ledger — growth vs added-money classification", () => {
  const s = () => useStore.getState();

  it("a NEW account defaults to a 'tracking' event (pre-owned money, not savings)", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 100000 }]));
    const f = s().portfolio.flows;
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("tracking");
    expect(f[0].amount).toBe(100000);
    expect(f[0].source).toBe("account_added");
  });

  it("a NEW account marked as new money records a 'flow' event", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 100000 }]), "new", "flow");
    expect(s().portfolio.flows[0].kind).toBe("flow");
  });

  it("a new LIABILITY account records a negative amount (matches the snapshot sign)", () => {
    const loan: ImportDraft = {
      account: { name: "Loan", institution: "Bank", accountType: "liability", taxTreatment: "na", region: "India", currency: "INR" },
      holdings: [{ name: "Home loan", assetClass: "other", marketValue: 40000, currency: "INR" }],
      warnings: [], source: "test",
    };
    s().addDraft(loan);
    expect(s().portfolio.flows[0].amount).toBe(-40000);
  });

  it("re-import decomposes: bought units become a flow, price moves stay growth", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 1000, units: 10 }])); // tracking event
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 1800, units: 15 }])); // 15 @120
    const f = s().portfolio.flows;
    expect(f).toHaveLength(2);
    expect(f[1].kind).toBe("flow");
    expect(f[1].amount).toBe(600); // 5 bought × 120; the 200 price gain is residual growth
    expect(f[1].source).toBe("import");
  });

  it("re-import with only a price move records NO event (zero amounts are skipped)", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 1000, units: 10 }]));
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 1200, units: 10 }]));
    expect(s().portfolio.flows).toHaveLength(1); // just the original account_added
  });

  it("a no-units balance jump lands in 'unclassified', not savings", () => {
    s().addDraft(basisDraft("PPF", [{ name: "PPF balance", marketValue: 1000 }]));
    s().addDraft(basisDraft("PPF", [{ name: "PPF balance", marketValue: 1300 }]));
    const last = s().portfolio.flows[s().portfolio.flows.length - 1];
    expect(last.kind).toBe("unclassified");
    expect(last.amount).toBe(300);
  });

  it("removing a holding by hand is a tracking change (stopped tracking, not a sale)", () => {
    s().addDraft(basisDraft("Demat", [{ name: "TCS", marketValue: 5000 }]));
    const hid = s().portfolio.holdings[0].id;
    s().removeHolding(hid);
    const last = s().portfolio.flows[s().portfolio.flows.length - 1];
    expect(last.kind).toBe("tracking");
    expect(last.amount).toBe(-5000);
  });

  it("load() backfills flows[] on files saved before the feature existed", async () => {
    const saved = emptyPortfolio() as unknown as { flows?: unknown };
    delete saved.flows;
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));
    await useStore.getState().load();
    expect(Array.isArray(useStore.getState().portfolio.flows)).toBe(true);
  });
});
