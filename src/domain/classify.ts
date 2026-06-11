// Forgiving normalization of free-text values into our enums — ported and India-ified
// from tally/backend/app/ai_import.py (_norm + alias maps) and csv_import.py (_enum).
// Used by both the CSV importer and the AI-extraction validator so weak inputs still
// land on the right class.

import type { AccountType, AssetClass, Region, TaxTreatment } from "./types";

const ASSET_CLASSES: AssetClass[] = [
  "indian_equity", "equity_mf", "index_etf", "elss", "debt_mf", "nps", "epf_ppf",
  "fd_rd", "structured_notes", "gold_sgb", "gold_other", "reit_invit", "us_equity",
  "private_equity", "private_credit", "pms", "insurance", "crypto", "real_estate", "cash", "other",
];

const ACCOUNT_TYPES: AccountType[] = [
  "demat", "mutual_fund", "nps", "epf_ppf", "bank", "pms_aif", "foreign_broker",
  "real_estate", "income", "liability", "other",
];

const TAX_TREATMENTS: TaxTreatment[] = ["taxable", "eee_exempt", "nps", "us_pretax", "us_roth", "us_hsa", "na"];

// Free-text → AssetClass. Keys are already key-normalized (lowercase, _ for spaces).
const CLASS_ALIAS: Record<string, AssetClass> = {
  stock: "indian_equity", stocks: "indian_equity", share: "indian_equity",
  shares: "indian_equity", equity: "indian_equity", equities: "indian_equity",
  nse: "indian_equity", bse: "indian_equity",
  mutual_fund: "equity_mf", mf: "equity_mf", fund: "equity_mf", equity_fund: "equity_mf",
  index_fund: "index_etf", etf: "index_etf", etfs: "index_etf", index: "index_etf",
  tax_saver: "elss", tax_saving: "elss", elss_fund: "elss",
  debt: "debt_mf", debt_fund: "debt_mf", liquid_fund: "debt_mf", liquid: "debt_mf",
  bond_fund: "debt_mf", gilt: "debt_mf", hybrid: "debt_mf",
  national_pension: "nps", nps_tier1: "nps", nps_tier2: "nps",
  epf: "epf_ppf", ppf: "epf_ppf", vpf: "epf_ppf", pf: "epf_ppf", provident_fund: "epf_ppf",
  fd: "fd_rd", rd: "fd_rd", fixed_deposit: "fd_rd", recurring_deposit: "fd_rd",
  deposit: "fd_rd", bond: "fd_rd", bonds: "fd_rd", ncd: "fd_rd",
  structured_note: "structured_notes", structured_notes: "structured_notes",
  structured_product: "structured_notes", market_linked: "structured_notes",
  market_linked_debenture: "structured_notes", mld: "structured_notes",
  eln: "structured_notes", equity_linked_note: "structured_notes", autocallable: "structured_notes",
  sgb: "gold_sgb", sovereign_gold: "gold_sgb", sovereign_gold_bond: "gold_sgb",
  gold: "gold_other", gold_etf: "gold_other", gold_fund: "gold_other", silver: "gold_other",
  reit: "reit_invit", invit: "reit_invit",
  us_stock: "us_equity", rsu: "us_equity", espp: "us_equity", foreign_stock: "us_equity",
  private_equity: "private_equity", buyout: "private_equity", venture: "private_equity",
  venture_capital: "private_equity", vc: "private_equity", private_assets: "private_equity",
  private_markets: "private_equity", alternative_investments: "private_equity",
  private_credit: "private_credit", private_debt: "private_credit",
  direct_lending: "private_credit", credit_fund: "private_credit",
  pms: "pms", aif: "pms", portfolio_management: "pms", portfolio_management_service: "pms",
  ulip: "insurance", endowment: "insurance", lic: "insurance", policy: "insurance",
  insurance_policy: "insurance", moneyback: "insurance", traditional_plan: "insurance",
  bitcoin: "crypto", btc: "crypto", eth: "crypto",
  property: "real_estate", home: "real_estate", flat: "real_estate", land: "real_estate",
  plot: "real_estate", house: "real_estate",
  savings: "cash", sweep: "cash", money_market: "cash", cash_equivalent: "cash",
};

const ATYPE_ALIAS: Record<string, AccountType> = {
  broker: "demat", brokerage: "demat", trading: "demat", equity: "demat",
  mf: "mutual_fund", folio: "mutual_fund", amc: "mutual_fund",
  national_pension: "nps",
  epf: "epf_ppf", ppf: "epf_ppf", pf: "epf_ppf",
  savings: "bank", checking: "bank", fd: "bank", deposit: "bank",
  pms: "pms_aif", aif: "pms_aif",
  foreign: "foreign_broker", us_broker: "foreign_broker", overseas: "foreign_broker",
  property: "real_estate", home: "real_estate",
  salary: "income", rent: "income",
  loan: "liability", mortgage: "liability", home_loan: "liability",
};

const TAX_ALIAS: Record<string, TaxTreatment> = {
  taxable: "taxable", normal: "taxable", non_qualified: "taxable",
  exempt: "eee_exempt", eee: "eee_exempt", tax_free: "eee_exempt", tax_exempt: "eee_exempt",
  national_pension: "nps",
  "401k": "us_pretax", "401(k)": "us_pretax", "403b": "us_pretax", "403(b)": "us_pretax",
  traditional_ira: "us_pretax", ira: "us_pretax", pretax: "us_pretax", pre_tax: "us_pretax",
  roth: "us_roth", roth_ira: "us_roth", roth_401k: "us_roth",
  hsa: "us_hsa", health_savings: "us_hsa",
  none: "na", n_a: "na",
};

const REGION_ALIAS: Record<string, Region> = {
  in: "India", india: "India", bharat: "India",
  us: "US", usa: "US", united_states: "US", america: "US",
};

function normKey(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/[\s\-/]+/g, "_");
}

// Returns [value, wasExactlyRecognized]. Mirrors ai_import._norm.
function norm<T extends string>(
  value: unknown, allowed: T[], alias: Record<string, T>, def: T,
): [T, boolean] {
  const k = normKey(value);
  if (!k) return [def, false];
  if ((allowed as string[]).includes(k)) return [k as T, true];
  if (k in alias) return [alias[k], true];
  return [def, false];
}

export const normAssetClass = (v: unknown, def: AssetClass = "other") =>
  norm(v, ASSET_CLASSES, CLASS_ALIAS, def);
export const normAccountType = (v: unknown, def: AccountType = "demat") =>
  norm(v, ACCOUNT_TYPES, ATYPE_ALIAS, def);
export const normTaxTreatment = (v: unknown, def: TaxTreatment = "taxable") =>
  norm(v, TAX_TREATMENTS, TAX_ALIAS, def);
// US wrappers announce themselves in account names ("Fidelity 401(k)", "Roth IRA",
// "HSA Bank") — statements rarely carry a tax column. Name-keyed, so safe in every
// region: Indian statements never say 401k. Roth wins over the IRA/401k match
// ("Roth 401(k)" is Roth money).
export function usTaxFromName(name: string): TaxTreatment | null {
  if (/\broth\b/i.test(name)) return "us_roth";
  if (/\bhsa\b|health savings/i.test(name)) return "us_hsa";
  if (/40[13]\s*\(?[kb]\)?|\bira\b/i.test(name)) return "us_pretax";
  return null;
}

export const normRegion = (v: unknown, def: Region = "India"): [Region, boolean] =>
  norm(v, ["India", "US", "Other"], REGION_ALIAS, def);

// Display order for the asset-class allocation view (most-growthy → safest, India-ish).
export const ASSET_CLASS_ORDER: AssetClass[] = [
  "indian_equity", "equity_mf", "index_etf", "elss", "us_equity", "private_equity",
  "reit_invit", "private_credit", "pms", "debt_mf", "nps", "epf_ppf", "fd_rd",
  "structured_notes", "gold_sgb", "gold_other", "insurance", "crypto", "cash", "real_estate", "other",
];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  indian_equity: "Indian Equity", equity_mf: "Equity MF", index_etf: "Index / ETF",
  elss: "ELSS", debt_mf: "Debt MF", nps: "NPS", epf_ppf: "EPF / PPF", fd_rd: "FD / RD",
  structured_notes: "Structured Notes", gold_sgb: "Gold (SGB)", gold_other: "Gold (other)",
  reit_invit: "REIT / InvIT", us_equity: "US Equity", private_equity: "Private Equity",
  private_credit: "Private Credit", pms: "PMS / AIF", insurance: "Insurance", crypto: "Crypto",
  real_estate: "Real Estate", cash: "Cash", other: "Other",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  demat: "Demat / Broker", mutual_fund: "Mutual Fund", nps: "NPS", epf_ppf: "EPF / PPF",
  bank: "Bank", pms_aif: "PMS / AIF", foreign_broker: "Foreign Broker",
  real_estate: "Real Estate", income: "Income", liability: "Liability", other: "Other",
};

export const TAX_LABEL: Record<TaxTreatment, string> = {
  taxable: "Taxable", eee_exempt: "Tax-free (EEE)", nps: "NPS",
  us_pretax: "Pre-tax (401k/IRA)", us_roth: "Roth", us_hsa: "HSA", na: "—",
};

// Liquid = can be sold/redeemed in days at a known price.
const LIQUID = new Set<AssetClass>([
  "indian_equity", "equity_mf", "index_etf", "elss", "debt_mf", "gold_sgb",
  "gold_other", "reit_invit", "us_equity", "crypto", "cash",
]);
export const isLiquid = (c: AssetClass) => LIQUID.has(c);

export function rankAssetClass(c: AssetClass): number {
  const i = ASSET_CLASS_ORDER.indexOf(c);
  return i === -1 ? ASSET_CLASS_ORDER.length : i;
}
