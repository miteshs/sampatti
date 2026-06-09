// The single source of truth for the on-device portfolio. zustand keeps it simple — no
// server, so there is nothing to cache or sync; we just load the local file on boot and
// debounce-save on every change.

import { create } from "zustand";
import {
  CURRENT_VERSION, emptyPortfolio, findMatchingAccount, type Account, type EditEvent, type Holding,
  type Income, type ImportDraft, type Portfolio, type Settings,
} from "../domain/types";
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL } from "../domain/classify";
import { snapshotOf, upsertSnapshot } from "../domain/snapshots";
import { clearLocalCaches, clearPortfolioRaw, readPortfolioRaw, writePortfolioRaw } from "../platform";

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

interface State {
  portfolio: Portfolio;
  loaded: boolean;
  load: () => Promise<void>;
  addDraft: (d: ImportDraft, mode?: "auto" | "new") => void;
  mergeDraftInto: (targetAccountId: string, d: ImportDraft) => void;
  addAccount: (a: Omit<Account, "id">) => string;
  updateAccount: (id: string, patch: Partial<Account>) => void;
  removeAccount: (id: string) => void;
  addHolding: (h: Omit<Holding, "id">) => string;
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
  p.edits.push({
    id: uid(), at: new Date().toISOString(), entity, entityId, label,
    field: FIELD_LABEL[field] ?? field,
    from: from === undefined ? undefined : showVal(field, from),
    to: to === undefined ? undefined : showVal(field, to),
  });
  if (p.edits.length > 250) p.edits = p.edits.slice(-250); // bound the trail
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

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

  load: async () => {
    try {
      const raw = await readPortfolioRaw();
      if (raw) {
        const p = JSON.parse(raw) as Portfolio;
        // Forward-compatible defaults for any setting added after the file was written.
        const defaults = emptyPortfolio().settings;
        p.settings = { ...defaults, ...p.settings };
        // Backfill an empty relay URL with the current default. A portfolio saved before
        // a relay was configured stores relayUrl:"" which would otherwise win the merge
        // above and leave relay mode unconfigured on upgrade.
        if (!p.settings.relayUrl) p.settings.relayUrl = defaults.relayUrl;
        if (!Array.isArray(p.edits)) p.edits = []; // added after some files were written
        if (!Array.isArray(p.snapshots)) p.snapshots = []; // ditto
        p.version = CURRENT_VERSION;
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

  addDraft: (d, mode = "auto") =>
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

  addHolding: (h) => {
    const id = uid();
    commit(set, get, (p) => p.holdings.push({ ...h, id }));
    return id;
  },
  updateHolding: (id, patch) =>
    commit(set, get, (p) => {
      const h = p.holdings.find((x) => x.id === id);
      if (h) Object.assign(h, patch);
    }),
  removeHolding: (id) => commit(set, get, (p) => { p.holdings = p.holdings.filter((h) => h.id !== id); }),

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
    ensureBasis(p);
    recordSnapshot(p);
    persist(p);
    set(() => ({ portfolio: p, loaded: true }));
  },

  wipe: async () => {
    await clearPortfolioRaw();
    clearLocalCaches(); // also drop the net-worth price-history cache + any other local caches
    set(() => ({ portfolio: emptyPortfolio() }));
  },
}));

// Download a copy of everything (the Privacy screen's "Export all").
export function exportPortfolio(p: Portfolio) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sampatti-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
