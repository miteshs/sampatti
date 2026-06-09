// The single source of truth for the on-device portfolio. zustand keeps it simple — no
// server, so there is nothing to cache or sync; we just load the local file on boot and
// debounce-save on every change.

import { create } from "zustand";
import {
  CURRENT_VERSION, emptyPortfolio, type Account, type Holding, type Income,
  type ImportDraft, type Portfolio, type Settings,
} from "../domain/types";
import { clearPortfolioRaw, readPortfolioRaw, writePortfolioRaw } from "../platform";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

interface State {
  portfolio: Portfolio;
  loaded: boolean;
  load: () => Promise<void>;
  addDraft: (d: ImportDraft) => void;
  addAccount: (a: Omit<Account, "id">) => string;
  updateAccount: (id: string, patch: Partial<Account>) => void;
  removeAccount: (id: string) => void;
  addHolding: (h: Omit<Holding, "id">) => void;
  updateHolding: (id: string, patch: Partial<Holding>) => void;
  removeHolding: (id: string) => void;
  addIncome: (i: Omit<Income, "id">) => void;
  removeIncome: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  replaceAll: (p: Portfolio) => void;
  wipe: () => Promise<void>;
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
        p.version = CURRENT_VERSION;
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

  addDraft: (d) =>
    commit(set, get, (p) => {
      const accountId = uid();
      p.accounts.push({ ...d.account, id: accountId });
      for (const h of d.holdings) p.holdings.push({ ...h, id: uid(), accountId });
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

  addHolding: (h) => commit(set, get, (p) => p.holdings.push({ ...h, id: uid() })),
  updateHolding: (id, patch) =>
    commit(set, get, (p) => {
      const h = p.holdings.find((x) => x.id === id);
      if (h) Object.assign(h, patch);
    }),
  removeHolding: (id) => commit(set, get, (p) => { p.holdings = p.holdings.filter((h) => h.id !== id); }),

  addIncome: (i) => commit(set, get, (p) => p.income.push({ ...i, id: uid() })),
  removeIncome: (id) => commit(set, get, (p) => { p.income = p.income.filter((x) => x.id !== id); }),

  updateSettings: (patch) => commit(set, get, (p) => Object.assign(p.settings, patch)),

  replaceAll: (p) => {
    persist(p);
    set(() => ({ portfolio: p, loaded: true }));
  },

  wipe: async () => {
    await clearPortfolioRaw();
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
