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

// How gains/income from the account are taxed in India — drives the AI's tax reasoning.
export type TaxTreatment =
  | "taxable" // normal taxable holdings (equity LTCG/STCG, etc.)
  | "eee_exempt" // PPF/EPF/SSY-style exempt-exempt-exempt
  | "nps" // NPS — partly exempt, annuity taxed (its own regime)
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
  costBasis?: number;
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

export interface Settings {
  country: "India"; // country drives the analyst persona + tax rules; India in v1
  baseCurrency: string; // "INR"
  claudeMode: "relay" | "byo"; // relay (hosted, default) | byo (your own key)
  relayUrl: string;
  usdInr: number; // FX used to convert USD holdings into the INR base (v1: manual)
  // The BYO key itself is NOT stored here — it lives in the OS keychain (desktop)
  // or sessionStorage (web fallback). This flag only records whether one is set.
  byoKeySet: boolean;
  analysisModel: string; // which Claude model writes the analysis (cost vs. quality)
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

export interface Portfolio {
  version: number;
  accounts: Account[];
  holdings: Holding[];
  income: Income[];
  settings: Settings;
  edits: EditEvent[];
  updatedAt: string;
}

export const CURRENT_VERSION = 1;

export function emptyPortfolio(): Portfolio {
  return {
    version: CURRENT_VERSION,
    accounts: [],
    holdings: [],
    income: [],
    edits: [],
    settings: {
      country: "India",
      baseCurrency: "INR",
      claudeMode: "relay",
      relayUrl: "https://sampatti-relay.sampatti.workers.dev", // hosted relay; override or switch to your own key on Privacy
      usdInr: 95, // fallback; refresh to a live rate on the Privacy screen
      byoKeySet: false,
      analysisModel: "claude-sonnet-4-6", // balanced default; pick Opus/Haiku on Privacy
    },
    updatedAt: new Date().toISOString(),
  };
}

// Whether AI analysis can actually reach Claude: BYO mode needs a key in place; relay
// mode needs a real relay URL configured (a blank/placeholder URL doesn't count).
export function analysisReady(s: Settings): boolean {
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
