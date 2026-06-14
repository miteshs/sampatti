// The single source of truth for the on-device portfolio. zustand keeps it simple — no
// server, so there is nothing to cache or sync; we just load the local file on boot and
// debounce-save on every change.

import { create } from "zustand";
import {
  CURRENT_VERSION, emptyPortfolio, findMatchingAccount, type Account, type EditEvent, type FlowEvent,
  type FlowKind, type Holding, type Income, type ImportDraft, type Portfolio, type Settings,
} from "../domain/types";
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL } from "../domain/classify";
import { snapshotOf, todayLocal, upsertSnapshot } from "../domain/snapshots";
import { decomposeReplace } from "../domain/flows";
import { holdingBase } from "../domain/format";
import { clearLocalCaches, clearPortfolioRaw, isIOS, isTauri, readPortfolioRaw, writePortfolioRaw } from "../platform";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Every holding carries a cost basis: a real one (statement/user) or, failing that, its value
// when it FIRST entered the app, flagged estimated — so P&L reads "since first import" and tax
// math knows not to trust it. Idempotent; runs on every commit and on load (migrates old files).
function ensureBasis(p: Portfolio): boolean {
  let changed = false;
  for (const h of p.holdings) {
    if (h.costBasis == null) {
      h.costBasis = h.marketValue;
      h.costBasisEstimated = true;
      changed = true;
    }
  }
  return changed;
}

// Record (or refresh) today's snapshot from the current state. Skipped while the portfolio is
// empty so first-run/demo-browsing doesn't write a ₹0 day. Returns true when anything changed.
function recordSnapshot(p: Portfolio): boolean {
  if (!Array.isArray(p.snapshots)) p.snapshots = [];
  if (p.holdings.length === 0) return false;
  return upsertSnapshot(p.snapshots, snapshotOf(p));
}

// Append a classified money movement (see FlowEvent in types.ts). Growth is never recorded —
// it's the residual the trend card derives — so only flow/tracking/unclassified land here.
const MAX_FLOWS = 2000;
function pushFlow(p: Portfolio, accountId: string, amount: number, kind: FlowKind,
                  source: FlowEvent["source"], label?: string) {
  if (!Array.isArray(p.flows)) p.flows = [];
  if (Math.round(amount) === 0) return;
  p.flows.push({ id: uid(), date: todayLocal(), accountId, amount: Math.round(amount), kind, source, label });
  if (p.flows.length > MAX_FLOWS) p.flows = p.flows.slice(-MAX_FLOWS);
}

// A saved AI analysis conversation. SESSION-SCOPED: kept in memory so it survives tab
// switches, but deliberately NOT written to portfolio.json (an analysis is regenerable and the
// transcript would bloat the data file). Lost on app restart.
export interface AnalysisTurn { role: "assistant" | "user"; text: string }
export interface AnalysisRun {
  id: string;
  at: string;       // ISO — when the analysis was started
  title: string;
  netWorth: number; // snapshot of net worth at run time, for the history label
  turns: AnalysisTurn[];
}
const MAX_ANALYSES = 20;

interface State {
  portfolio: Portfolio;
  loaded: boolean;
  load: () => Promise<void>;
  // Session-scoped AI analysis history (see AnalysisRun) — not persisted to disk.
  analyses: AnalysisRun[];
  activeAnalysisId: string | null;
  analysisStreaming: boolean;
  newAnalysis: (meta: { title: string; netWorth: number }) => string;
  setAnalysisTurns: (id: string, turns: AnalysisTurn[]) => void;
  setAnalysisStreaming: (on: boolean) => void;
  selectAnalysis: (id: string | null) => void;
  deleteAnalysis: (id: string) => void;
  // newAccountMoney: when the draft creates a NEW account, is its value money you already
  // had (tracking — the safe default) or fresh savings (flow)? Asked on the review card.
  addDraft: (d: ImportDraft, mode?: "auto" | "new", newAccountMoney?: FlowKind) => void;
  mergeDraftInto: (targetAccountId: string, d: ImportDraft) => void;
  addAccount: (a: Omit<Account, "id">) => string;
  updateAccount: (id: string, patch: Partial<Account>) => void;
  removeAccount: (id: string) => void;
  addHolding: (h: Omit<Holding, "id">, money?: FlowKind) => string;
  updateHolding: (id: string, patch: Partial<Holding>) => void;
  removeHolding: (id: string) => void;
  // Logging variants used by the manual editor (record the change to the edits[] trail).
  editAccount: (id: string, patch: Partial<Account>) => void;
  editHolding: (id: string, patch: Partial<Holding>) => void;
  logEdit: (e: Omit<EditEvent, "id" | "at">) => void;
  clearEdits: () => void;
  addIncome: (i: Omit<Income, "id">) => void;
  removeIncome: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  replaceAll: (p: Portfolio) => void;
  importBackup: (text: string) => void; // restore a full exported portfolio (.json), incl. history
  wipe: () => Promise<void>;
}

// Replace an existing account's holdings wholesale from a freshly imported statement, keeping
// the account's id and excluded flag. "Wholesale" is deliberate: a new statement reflects
// reality at its date — items sold/liquidated since the last import simply aren't in it, so
// dropping the old holdings and taking the statement's set is correct (no merge/dedupe of
// individual lots). The account's metadata (name, type, tax, currency, as-of date…) is also
// refreshed from the statement.
function replaceAccountHoldings(p: Portfolio, existing: Account, d: ImportDraft) {
  const { excluded } = existing;
  const old = p.holdings.filter((h) => h.accountId === existing.id);

  // Classify WHY this statement moved the account's value: units math splits bought/sold
  // (flow) from price movement (growth, left as the residual); no-units deltas are honest
  // "unclassified". Powers the growth-vs-added split on the trend card.
  const dec = decomposeReplace(old, d.holdings, p.settings.usdInr);
  pushFlow(p, existing.id, dec.flow, "flow", "import", `${d.account.name || existing.name} · statement update`);
  pushFlow(p, existing.id, dec.unclassified, "unclassified", "import", `${d.account.name || existing.name} · statement update`);

  p.holdings = p.holdings.filter((h) => h.accountId !== existing.id);
  Object.assign(existing, d.account, { id: existing.id, excluded });

  // Carry cost basis / buy date forward when the new statement doesn't supply them, matching
  // old holdings by symbol+name, then symbol, then name. Without this, every monthly re-import
  // would reset "gain since first import" to zero for holdings whose statements lack a cost
  // column. A statement that DOES carry a basis always wins. Each old holding is consumed once.
  const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
  const used = new Set<Holding>();
  const matchOld = (h: ImportDraft["holdings"][number]): Holding[] => {
    const bySymName = old.filter((o) => !used.has(o) && norm(o.symbol) === norm(h.symbol) && norm(o.name) === norm(h.name));
    if (bySymName.length) return bySymName;
    if (norm(h.symbol)) {
      const bySym = old.filter((o) => !used.has(o) && norm(o.symbol) === norm(h.symbol));
      if (bySym.length) return bySym;
    }
    return old.filter((o) => !used.has(o) && norm(o.name) === norm(h.name));
  };

  for (const h of d.holdings) {
    const carried: Partial<Holding> = {};
    if (h.costBasis == null || h.buyDate == null) {
      const matches = matchOld(h).filter((o) => o.costBasis != null || o.buyDate != null);
      if (matches.length) {
        matches.forEach((o) => used.add(o));
        if (h.costBasis == null && matches.some((o) => o.costBasis != null)) {
          const est = matches.some((o) => o.costBasisEstimated);
          let basis = matches.reduce((s, o) => s + (o.costBasis ?? 0), 0);
          // An estimated anchor is ≈ price-at-first-import × units, so scale it when the
          // position size changed; a REAL basis is a fact and is never scaled.
          const oldUnits = matches.reduce((s, o) => s + (o.units ?? 0), 0);
          if (est && oldUnits > 0 && typeof h.units === "number" && h.units > 0) {
            basis = Math.round((basis * h.units) / oldUnits);
          }
          carried.costBasis = basis;
          carried.costBasisEstimated = est || undefined;
        }
        if (h.buyDate == null) {
          const dates = matches.map((o) => o.buyDate).filter((x): x is string => !!x).sort();
          if (dates.length) carried.buyDate = dates[0]; // earliest = "held since"
        }
      }
    }
    p.holdings.push({ ...h, ...carried, id: uid(), accountId: existing.id });
  }
}

// ---- manual-edit trail helpers ----
const FIELD_LABEL: Record<string, string> = {
  name: "name", institution: "institution", accountType: "type", taxTreatment: "tax",
  region: "region", currency: "currency", asOf: "statement date", note: "note",
  assetClass: "asset class", marketValue: "value", units: "units", buyDate: "buy date", symbol: "symbol",
  costBasis: "cost basis",
};
// Bookkeeping fields that ride along with a real edit and shouldn't clutter the trail.
const SILENT_FIELDS = new Set(["costBasisEstimated"]);
function showVal(field: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (field === "assetClass") return ASSET_CLASS_LABEL[v as keyof typeof ASSET_CLASS_LABEL] ?? String(v);
  if (field === "accountType") return ACCOUNT_TYPE_LABEL[v as keyof typeof ACCOUNT_TYPE_LABEL] ?? String(v);
  if (field === "taxTreatment") return TAX_LABEL[v as keyof typeof TAX_LABEL] ?? String(v);
  if (field === "marketValue" || field === "units" || field === "costBasis") return Number(v).toLocaleString("en-IN");
  return String(v);
}
function pushEdit(p: Portfolio, entity: "account" | "holding", entityId: string, label: string, field: string, from?: unknown, to?: unknown) {
  const fieldLabel = FIELD_LABEL[field] ?? field;
  const toStr = to === undefined ? undefined : showVal(field, to);
  // Coalesce a run of edits to the SAME field of the same entity into one entry — typing in a
  // text input fires onChange per keystroke, which would otherwise log "Etra→Etrad", "Etrad→
  // Etrade", … instead of a single "Etrad…→Etrade". Keep the original `from`, advance the `to`.
  const last = p.edits[p.edits.length - 1];
  if (last && last.entity === entity && last.entityId === entityId && last.field === fieldLabel) {
    last.to = toStr;
    last.at = new Date().toISOString();
    if (last.from === last.to) p.edits.pop(); // typed back to where it started → no net change
    return;
  }
  p.edits.push({
    id: uid(), at: new Date().toISOString(), entity, entityId, label,
    field: fieldLabel,
    from: from === undefined ? undefined : showVal(field, from),
    to: toStr,
  });
  if (p.edits.length > 250) p.edits = p.edits.slice(-250); // bound the trail
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Bring a parsed portfolio (from disk OR an imported backup) up to the current shape:
// forward-compatible setting defaults, deep-merge of nested settings, array backfills, and the
// current version stamp. Mutates and returns the same object.
function migrate(p: Portfolio): Portfolio {
  const defaults = emptyPortfolio().settings;
  p.settings = { ...defaults, ...p.settings };
  // A portfolio saved before a relay was configured stores relayUrl:"" which would otherwise
  // win the merge above and leave relay mode unconfigured on upgrade.
  if (!p.settings.relayUrl) p.settings.relayUrl = defaults.relayUrl;
  // Nested settings added later deep-merge (the shallow spread only covers the top level).
  p.settings.ai = { ...defaults.ai, ...(p.settings.ai ?? {}) };
  p.settings.insights = { ...defaults.insights, ...(p.settings.insights ?? {}) };
  for (const k of ["accounts", "holdings", "income", "edits", "snapshots", "flows"] as const) {
    if (!Array.isArray(p[k])) (p as unknown as Record<string, unknown[]>)[k] = [];
  }
  p.version = CURRENT_VERSION;
  return p;
}

function persist(p: Portfolio) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void writePortfolioRaw(JSON.stringify(p));
  }, 250);
}

// Apply a change to the portfolio, stamp updatedAt, persist, and return the new object.
function commit(set: (fn: (s: State) => Partial<State>) => void, get: () => State,
                mutate: (p: Portfolio) => void) {
  const p = structuredClone(get().portfolio);
  mutate(p);
  ensureBasis(p);
  recordSnapshot(p); // every change refreshes today's recorded net worth
  p.updatedAt = new Date().toISOString();
  persist(p);
  set(() => ({ portfolio: p }));
}

export const useStore = create<State>((set, get) => ({
  portfolio: emptyPortfolio(),
  loaded: false,

  // ---- session-scoped AI analysis history (not persisted; plain set, never commit) ----
  analyses: [],
  activeAnalysisId: null,
  analysisStreaming: false,
  newAnalysis: ({ title, netWorth }) => {
    const id = uid();
    set((s) => ({
      analyses: [...s.analyses, { id, at: new Date().toISOString(), title, netWorth, turns: [] }].slice(-MAX_ANALYSES),
      activeAnalysisId: id,
    }));
    return id;
  },
  setAnalysisTurns: (id, turns) =>
    set((s) => ({ analyses: s.analyses.map((a) => (a.id === id ? { ...a, turns } : a)) })),
  setAnalysisStreaming: (on) => set(() => ({ analysisStreaming: on })),
  selectAnalysis: (id) => set(() => ({ activeAnalysisId: id })),
  deleteAnalysis: (id) =>
    set((s) => ({
      analyses: s.analyses.filter((a) => a.id !== id),
      activeAnalysisId: s.activeAnalysisId === id ? null : s.activeAnalysisId,
    })),

  load: async () => {
    try {
      const raw = await readPortfolioRaw();
      if (raw) {
        const p = migrate(JSON.parse(raw) as Portfolio);
        // Migrate basis-less holdings + record today's snapshot (opening the app daily is what
        // builds the recorded history) — persist only when something actually changed.
        const migrated = ensureBasis(p);
        const snapped = recordSnapshot(p);
        if (migrated || snapped) persist(p);
        set(() => ({ portfolio: p, loaded: true }));
        return;
      }
    } catch (e) {
      // First run, unreadable/corrupt file, or storage error → start clean rather
      // than spin forever. Always fall through to marking the app loaded.
      console.error("portfolio load failed:", e);
    }
    set(() => ({ loaded: true }));
  },

  addDraft: (d, mode = "auto", newAccountMoney = "tracking") =>
    commit(set, get, (p) => {
      // Re-import of a known account (same institution + name): replace its holdings in place,
      // keeping id + excluded flag, so it updates rather than duplicating.
      const existing = mode === "auto" ? findMatchingAccount(p.accounts, d.account) : undefined;
      if (existing) {
        replaceAccountHoldings(p, existing, d);
      } else {
        const accountId = uid();
        p.accounts.push({ ...d.account, id: accountId });
        for (const h of d.holdings) p.holdings.push({ ...h, id: uid(), accountId });
        // The whole account just appeared in the record — classify the step it creates
        // (signed like the snapshot: liabilities pull net worth down).
        const sign = d.account.accountType === "liability" ? -1 : 1;
        const total = d.holdings.reduce((s, h) => s + holdingBase(h as Holding, p.settings.usdInr), 0);
        pushFlow(p, accountId, sign * total, newAccountMoney, "account_added", d.account.name);
      }
    }),

  // Apply a statement to a user-chosen existing account (when auto-match didn't fire but the
  // user knows it's the same account, possibly renamed). Same wholesale-replace semantics.
  mergeDraftInto: (targetAccountId, d) =>
    commit(set, get, (p) => {
      const existing = p.accounts.find((a) => a.id === targetAccountId);
      if (existing) replaceAccountHoldings(p, existing, d);
    }),

  addAccount: (a) => {
    const id = uid();
    commit(set, get, (p) => p.accounts.push({ ...a, id }));
    return id;
  },
  updateAccount: (id, patch) =>
    commit(set, get, (p) => {
      const a = p.accounts.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    }),
  removeAccount: (id) =>
    commit(set, get, (p) => {
      p.accounts = p.accounts.filter((a) => a.id !== id);
      p.holdings = p.holdings.filter((h) => h.accountId !== id);
    }),

  addHolding: (h, money = "tracking") => {
    const id = uid();
    commit(set, get, (p) => {
      p.holdings.push({ ...h, id });
      const sign = p.accounts.find((a) => a.id === h.accountId)?.accountType === "liability" ? -1 : 1;
      pushFlow(p, h.accountId, sign * holdingBase(h as Holding, p.settings.usdInr), money, "manual", `added: ${h.name}`);
    });
    return id;
  },
  updateHolding: (id, patch) =>
    commit(set, get, (p) => {
      const h = p.holdings.find((x) => x.id === id);
      if (h) Object.assign(h, patch);
    }),
  removeHolding: (id) => commit(set, get, (p) => {
    const h = p.holdings.find((x) => x.id === id);
    p.holdings = p.holdings.filter((x) => x.id !== id);
    if (h) {
      // Stopped tracking it (a SALE should arrive via a statement re-import instead, where
      // the units math classifies it as a flow).
      const sign = p.accounts.find((a) => a.id === h.accountId)?.accountType === "liability" ? -1 : 1;
      pushFlow(p, h.accountId, -sign * holdingBase(h, p.settings.usdInr), "tracking", "edit", `removed: ${h.name}`);
    }
  }),

  // Manual edits go through these so each changed field is recorded in the edits[] trail.
  editAccount: (id, patch) =>
    commit(set, get, (p) => {
      const a = p.accounts.find((x) => x.id === id);
      if (!a) return;
      const rec = a as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (rec[k] !== v) pushEdit(p, "account", id, a.name, k, rec[k], v);
      Object.assign(a, patch);
    }),
  editHolding: (id, patch) =>
    commit(set, get, (p) => {
      const h = p.holdings.find((x) => x.id === id);
      if (!h) return;
      const rec = h as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (!SILENT_FIELDS.has(k) && rec[k] !== v) pushEdit(p, "holding", id, h.name, k, rec[k], v);
      }
      Object.assign(h, patch);
    }),
  logEdit: (e) => commit(set, get, (p) => {
    p.edits.push({ id: uid(), at: new Date().toISOString(), ...e });
    if (p.edits.length > 250) p.edits = p.edits.slice(-250);
  }),
  clearEdits: () => commit(set, get, (p) => { p.edits = []; }),

  addIncome: (i) => commit(set, get, (p) => p.income.push({ ...i, id: uid() })),
  removeIncome: (id) => commit(set, get, (p) => { p.income = p.income.filter((x) => x.id !== id); }),

  updateSettings: (patch) => commit(set, get, (p) => Object.assign(p.settings, patch)),

  replaceAll: (p) => {
    // Appearance is a device/UI preference, not portfolio data — carry the current choice across
    // a wholesale replace (load demo, import) so dark mode isn't reset to the incoming default.
    p.settings.theme = get().portfolio.settings.theme ?? p.settings.theme;
    ensureBasis(p);
    recordSnapshot(p);
    persist(p);
    set(() => ({ portfolio: p, loaded: true }));
  },

  // Restore a full exported portfolio (.json) — accounts, holdings, income, AND the recorded
  // snapshots/flows, so the trend history comes back too. Migrated through the same path as a
  // disk load; replaceAll keeps the device's current theme.
  importBackup: (text) => {
    const parsed = JSON.parse(text) as Partial<Portfolio> | null;
    const looksValid = !!parsed && typeof parsed === "object"
      && Array.isArray(parsed.accounts) && Array.isArray(parsed.holdings) && typeof parsed.settings === "object";
    if (!looksValid) throw new Error("That doesn't look like a Sampatti backup (use a .json file exported from Sampatti).");
    get().replaceAll(migrate(parsed as Portfolio));
  },

  wipe: async () => {
    const theme = get().portfolio.settings.theme; // keep the appearance choice through an erase
    await clearPortfolioRaw();
    clearLocalCaches(); // also drop the net-worth price-history cache + any other local caches
    const fresh = emptyPortfolio();
    fresh.settings.theme = theme;
    set(() => ({ portfolio: fresh }));
  },
}));

// Save a copy of everything (the Privacy screen's "Export all").
// Desktop: native Save dialog + fs write — blob-anchor downloads are unreliable inside
// webviews (found broken in WebView2 on Windows). The dialog plugin auto-allows the chosen
// path in the fs scope, so no extra capability is needed. Web preview keeps the browser
// download. Returns the written path (or the download name), null if the user cancelled.
// Save text to a file the user picks — native Save dialog on desktop, share sheet on iOS,
// blob download on the web. Returns the destination (path/name) or null if cancelled.
export async function saveTextFile(content: string, name: string, mime: string, ext: string): Promise<string | null> {
  if (isTauri() && !isIOS()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, content);
    return path;
  }
  // iOS has no save panel — use the native share sheet via the Web Share API (supported in the
  // iOS WKWebView). The user picks Files / Mail / AirDrop. Cancel → AbortError → null.
  if (isIOS() && typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
    const file = new File([content], name, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Sampatti export" });
        return name;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return null;
        // Sharing failed for another reason — fall through to the blob download below.
      }
    }
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking synchronously can race the engine's download start; defer it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

export async function exportPortfolio(p: Portfolio): Promise<string | null> {
  return saveTextFile(JSON.stringify(p, null, 2), `sampatti-portfolio-${new Date().toISOString().slice(0, 10)}.json`, "application/json", "json");
}

// Render a saved AI analysis as Markdown for export. Pure (testable).
export function analysisMarkdown(run: AnalysisRun): string {
  const out = [`# ${run.title}`, "", `_Sampatti AI analysis · ${new Date(run.at).toLocaleString()}_`, ""];
  for (const t of run.turns) {
    if (!t.text.trim()) continue;
    out.push(t.role === "user" ? `## Your question\n\n${t.text}` : `## Analysis\n\n${t.text}`, "");
  }
  return out.join("\n").trimEnd() + "\n";
}
