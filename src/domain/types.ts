// The domain model — an India-first reframing of tally/backend/app/models.py.
// Everything here lives only on the user's machine (see src/storage/store.ts).

// Asset classes a typical Indian investor holds. `us_equity` covers RSUs/ESPP held
// through a foreign broker; `gold_sgb` is kept distinct because Sovereign Gold Bonds
// have their own (tax-free-at-maturity) treatment.
export type AssetClass =
  | "indian_equity" // direct stocks on NSE/BSE
  | "equity_mf" // equity mutual funds
  | "index_etf" // index funds / ETFs
  | "elss" // tax-saving equity funds (80C, 3y lock-in)
  | "debt_mf" // debt / liquid / hybrid-debt funds
  | "nps" // National Pension System
  | "epf_ppf" // EPF / PPF / VPF
  | "fd_rd" // fixed & recurring deposits, bonds held to maturity
  | "structured_notes" // market-linked notes / MLDs / autocallables (bank-issued, illiquid)
  | "gold_sgb" // Sovereign Gold Bonds
  | "gold_other" // physical gold, gold ETFs/funds
  | "reit_invit" // REITs / InvITs
  | "us_equity" // foreign stocks (RSU/ESPP/overseas brokerage)
  | "private_equity" // PE / VC / buyout / private-markets funds (illiquid)
  | "private_credit" // private credit / direct-lending / private-debt funds (illiquid)
  | "pms" // Portfolio Management Service / AIF (managed, illiquid)
  | "insurance" // ULIP / endowment fund or surrender value (term life has no value)
  | "crypto"
  | "real_estate"
  | "cash"
  | "other";

export type AccountType =
  | "demat" // broker / demat (direct equity)
  | "mutual_fund" // MF folio (CAMS/KFintech)
  | "nps"
  | "epf_ppf"
  | "bank" // savings / FD / RD
  | "pms_aif" // PMS or AIF
  | "foreign_broker"
  | "real_estate"
  | "income" // a salary/rent/business income source (not a holdings account)
  | "liability" // home loan, other loans — subtracted from net worth
  | "other";

// How gains/income from the account are taxed — drives the AI's tax reasoning. IN and US
// wrappers coexist in one union (an NRI portfolio legitimately holds both kinds).
export type TaxTreatment =
  | "taxable" // normal taxable holdings (equity LTCG/STCG, etc.)
  | "eee_exempt" // PPF/EPF/SSY-style exempt-exempt-exempt
  | "nps" // NPS — partly exempt, annuity taxed (its own regime)
  | "us_pretax" // 401(k)/403(b)/Traditional IRA — deductible in, taxed on withdrawal
  | "us_roth" // Roth — taxed in, growth and qualified withdrawals tax-free
  | "us_hsa" // HSA — triple-advantaged
  | "na";

export type Region = "India" | "US" | "Other";

export interface Holding {
  id: string;
  accountId: string;
  symbol?: string; // ticker / ISIN / scheme code
  name: string;
  assetClass: AssetClass;
  units?: number;
  marketValue: number; // in the holding's currency (default account currency)
  costBasis?: number; // total invested, in the holding's currency
  // True when no real purchase cost was available and costBasis was set to the holding's
  // value when it FIRST entered the app — P&L then means "gain since first import", and
  // tax math must NOT treat it as an actual purchase price. Cleared when a statement or
  // the user supplies a real basis.
  costBasisEstimated?: boolean;
  buyDate?: string; // YYYY-MM-DD — enables STCG/LTCG holding-period buckets
  currency: string; // "INR" | "USD" | ...
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  accountType: AccountType;
  taxTreatment: TaxTreatment;
  region: Region;
  currency: string;
  asOf?: string; // statement date — drives staleness
  // For aggregate accounts entered as a single value (a flat, a PMS, a pension):
  // tag the whole account to one class and skip per-holding detail.
  defaultAssetClass?: AssetClass;
  note?: string;
  // When true the account is kept on file but excluded from every computation
  // (net worth, allocations, the brief, AI analysis). Toggled on the dashboard.
  excluded?: boolean;
}

export type IncomeKind = "salary" | "rent" | "business" | "dividend" | "interest" | "other";

export interface Income {
  id: string;
  source: string;
  kind: IncomeKind;
  amount: number; // per the frequency below
  frequency: "monthly" | "annual";
  currency: string;
  note?: string;
}

// Which engine performs an AI task. "claude" = the hosted/BYO Claude path (quality tier);
// "local" = the embedded on-device model (privacy/offline tier — nothing leaves the device).
// Per-task so a user can mix: e.g. extraction local, deep analysis on Claude.
export type AiEngine = "claude" | "local";
export interface AiRouting {
  extraction: AiEngine; // statement extraction fallback (PDF text / unrecognized layouts)
  analysis: AiEngine; // the portfolio review & chat
}

export interface Settings {
  // Drives the analyst persona, tax language, and money formatting via src/regions/profile.
  // Stored human-readable for save-file compat; regionOf() maps it (unknown → India).
  country: "India" | "US";
  baseCurrency: string; // "INR"
  claudeMode: "relay" | "byo"; // relay (hosted, default) | byo (your own key)
  relayUrl: string;
  // Optional access code for the relay — whoever runs it may require one (relay APP_TOKEN).
  // Lets a public/token-less build use someone else's relay by pasting the code they shared;
  // sent as x-app-token, taking precedence over the build-time token. Persisted in settings
  // (a low-sensitivity shared code — NOT the Anthropic key, which stays in the keychain).
  relayCode?: string;
  usdInr: number; // FX used to convert USD holdings into the INR base (v1: manual)
  // The BYO key itself is NOT stored here — it lives in the OS keychain (desktop)
  // or sessionStorage (web fallback). This flag only records whether one is set.
  byoKeySet: boolean;
  analysisModel: string; // which Claude model writes the analysis (cost vs. quality)
  // Optional free-text the client gives about their situation/goals (age, retirement year,
  // risk appetite…). Appended to the analysis request AFTER the cached brief block so it
  // tailors the review without touching the guardrails — and without breaking the brief cache.
  analysisContext?: string;
  // Visual theme. Opt-in dark mode — applied via a data-theme attribute, NOT
  // prefers-color-scheme, so the app never switches unless the user chooses it. Optional for
  // save-file compat; absent/unknown ⇒ light.
  theme?: "light" | "dark";
  // Optional, opt-in insight features — OFF by default so the default app stays minimal; each
  // is toggled on under Settings → Insights. Absent ⇒ all off.
  insights?: { healthScore?: boolean; goals?: boolean };
  // Saved assumptions for the (optional) retirement-outlook card, so they're remembered. All
  // optional — the UI supplies India-typical defaults (10% return, 6% inflation) when absent.
  retirement?: {
    currentAge?: number;
    retireAge?: number;
    monthlyContribution?: number; // base currency
    expectedReturnPct?: number;
    inflationPct?: number;
    desiredMonthlyIncome?: number; // today's money, base currency
  };
  ai: AiRouting; // per-task engine choice (default: claude for both)
  // Experimental features live behind this switch (today: the on-device AI engine).
  // Off = the app behaves as if they don't exist; settings.ai is kept but not honored.
  developerMode: boolean;
}

// A record of a manual edit the user made (so overrides are visible, and they know a value
// won't match a fresh import). Logged only for hand edits in the editor — never for live-price
// refreshes, account include/exclude, or imports.
export interface EditEvent {
  id: string;
  at: string; // ISO timestamp
  entity: "account" | "holding";
  entityId: string;
  label: string; // the account/holding name at edit time
  field: string; // human label, e.g. "asset class", "value", "added", "removed"
  from?: string;
  to?: string;
}

// A classified money movement, recorded whenever the app can tell WHY net worth changed —
// so the trend can split "your investments grew" from "you added money" from "you merely
// started/stopped tracking something". Growth itself is never stored: it is the residual
// (ΔNW − flows − tracking − unclassified), so there is a single source of truth.
export type FlowKind =
  | "flow" // real money in/out: bought with new savings, sold & withdrew
  | "tracking" // coverage change: started/stopped tracking an existing asset (NOT savings, NOT growth)
  | "unclassified"; // a statement delta we couldn't attribute (no units to split price vs quantity)

export interface FlowEvent {
  id: string;
  date: string; // YYYY-MM-DD (local) — same day-keying as snapshots
  accountId: string; // events follow account visibility, exactly like snapshots
  amount: number; // INR base, signed (+ in / − out)
  kind: FlowKind;
  source: "import" | "account_added" | "manual" | "edit";
  label?: string;
}

// One day's recorded net worth, stored per account (INR base; liability accounts negative)
// so the trend chart can re-sum over whichever accounts are currently included. Unlike the
// price-history reconstruction, these are REAL records of what the app computed that day —
// they capture buys/sells/FX as they happened and are not re-derivable later.
export interface DailySnapshot {
  date: string; // YYYY-MM-DD (local)
  accounts: Record<string, number>; // accountId → value in INR (negative = liability)
}

export interface Portfolio {
  version: number;
  accounts: Account[];
  holdings: Holding[];
  income: Income[];
  settings: Settings;
  edits: EditEvent[];
  snapshots: DailySnapshot[]; // ascending by date; one entry per day the app saw data
  flows: FlowEvent[]; // classified money movements (see FlowEvent); growth is the residual
  updatedAt: string;
}

export const CURRENT_VERSION = 1;

// The hosted relay every build points at by default. Exported so the UI can tell when the
// user has switched to a CUSTOM relay (the brief goes wherever this points — warn them).
export const DEFAULT_RELAY_URL = "https://sampatti-relay.sampatti.workers.dev";

export function emptyPortfolio(): Portfolio {
  return {
    version: CURRENT_VERSION,
    accounts: [],
    holdings: [],
    income: [],
    edits: [],
    snapshots: [],
    flows: [],
    settings: {
      country: "India",
      baseCurrency: "INR",
      claudeMode: "relay",
      relayUrl: DEFAULT_RELAY_URL, // hosted relay; override or switch to your own key in Settings
      usdInr: 95, // fallback; refresh to a live rate in Settings
      byoKeySet: false,
      analysisModel: "claude-sonnet-4-6", // balanced default; pick Opus/Haiku in Settings
      analysisContext: "", // client's own goals/context; tailors the AI review (see Settings type)
      theme: "light", // opt-in dark mode; light is the default everywhere
      insights: {}, // optional insight features are all off until the user opts in
      ai: { extraction: "claude", analysis: "claude" }, // per-task engine; local is opt-in
      developerMode: false, // experimental features stay invisible until switched on
    },
    updatedAt: new Date().toISOString(),
  };
}

// Whether AI analysis can actually reach Claude: BYO mode needs a key in place; relay
// mode needs a real relay URL configured (a blank/placeholder URL doesn't count).
export function analysisReady(s: Settings): boolean {
  // On-device analysis counts as ready only while developer mode honors it — with the
  // switch off, routing falls back to Claude, so Claude's requirements apply below.
  if (s.developerMode && s.ai.analysis === "local") return true; // model presence is checked at run time
  if (s.claudeMode === "byo") return s.byoKeySet;
  return /^https?:\/\/\S+/.test(s.relayUrl) && !s.relayUrl.includes("example.");
}

// A draft account+holdings produced by AI extraction or a file import, shown to the
// user for review before it is committed to the portfolio.
export interface ImportDraft {
  account: Omit<Account, "id">;
  holdings: Omit<Holding, "id" | "accountId">[];
  warnings: string[];
  source: string; // filename or "csv" / "ai"
}

// Accounts toggled off stay in the file (so they can be re-enabled) but are removed from
// every computation. Used by the dashboard and the AI brief so "exclude" means exclude
// everywhere. Returns the same object when nothing is excluded (cheap no-op).
export function visiblePortfolio(p: Portfolio): Portfolio {
  const hidden = new Set(p.accounts.filter((a) => a.excluded).map((a) => a.id));
  if (hidden.size === 0) return p;
  return {
    ...p,
    accounts: p.accounts.filter((a) => !a.excluded),
    holdings: p.holdings.filter((h) => !hidden.has(h.accountId)),
  };
}

// Identity used to decide whether an imported statement updates an existing account or
// creates a new one: institution + account name, normalized (case/space-insensitive).
export function accountKey(a: { name: string; institution: string }): string {
  return `${a.institution.trim().toLowerCase()}|${a.name.trim().toLowerCase()}`;
}

export function findMatchingAccount(
  accounts: Account[],
  draft: { name: string; institution: string },
): Account | undefined {
  const key = accountKey(draft);
  return accounts.find((a) => accountKey(a) === key);
}
