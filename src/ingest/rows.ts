// The canonical "Sampatti CSV/sheet" row shape and its mapping into ImportDrafts.
// A TS port of tally/backend/app/importers/csv_import.py, with India columns. One row per
// holding; rows sharing an `account` become one account (its meta comes from the first row).
//
//   account,institution,account_type,tax_treatment,region,currency,symbol,name,
//   asset_class,units,market_value,cost_basis,buy_date,as_of
//
// Only `account`, `name`, and `market_value` are required. We also recognize common US
// brokerage exports (Fidelity/Schwab "Portfolio Positions": Current Value, Description, …).

import { normAccountType, normAssetClass, normRegion, normTaxTreatment } from "../domain/classify";
import type { AssetClass, ImportDraft } from "../domain/types";

export type Row = Record<string, unknown>;
type Lowered = Record<string, string>;

// Coerce anything (string, number, or PapaParse's `__parsed_extra` array) to a clean string
// — guards against ".trim is not a function" on non-string cells.
export function num(s: unknown): number | undefined {
  const t = String(s ?? "").replace(/[₹$,\s]/g, "").trim();
  if (t === "" || ["--", "n/a", "na", "none"].includes(t.toLowerCase())) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

// Lowercase + trim header keys so "Market Value", "market_value", "MARKET VALUE" all match.
function lower(row: Row): Lowered {
  const out: Lowered = {};
  for (const [k, v] of Object.entries(row)) {
    out[String(k ?? "").trim().toLowerCase().replace(/\s+/g, "_")] = String(v ?? "").trim();
  }
  return out;
}

const CASH_LIKE = /money market|fdic|treasury only|cash reserves|SPAXX|FDRXX|FZFXX|SWVXX|VMFXX/i;

export function rowsToDrafts(rawRows: Row[], source: string): ImportDraft[] {
  const byAccount = new Map<string, ImportDraft>();
  const warnings: string[] = [];
  let skipped = 0;

  for (const raw of rawRows) {
    const r = lower(raw);
    const accountName = r.account || r.account_name || r.account_number;
    const name = r.name || r.description || r.security || r.symbol;
    const mv = num(r.market_value ?? r.value ?? r.amount ?? r.current_value);
    if (!accountName || !name || mv === undefined || mv === 0) {
      skipped += 1;
      continue;
    }

    // A US brokerage export (Fidelity/Schwab) — these columns exist and there's no
    // currency field, so default to USD/US rather than the Indian defaults.
    const looksUS = "current_value" in r || "last_price" in r || "today's_gain/loss_dollar" in r;

    let draft = byAccount.get(accountName);
    if (!draft) {
      draft = {
        account: {
          name: accountName,
          institution: r.institution || (looksUS ? "US Broker" : "Manual"),
          accountType: r.account_type ? normAccountType(r.account_type)[0] : looksUS ? "foreign_broker" : "demat",
          taxTreatment: normTaxTreatment(r.tax_treatment ?? r.tax_status)[0],
          region: r.region ? normRegion(r.region)[0] : looksUS ? "US" : "India",
          currency: (r.currency || (looksUS ? "USD" : "INR")).toUpperCase(),
          asOf: r.as_of || undefined,
        },
        holdings: [],
        warnings,
        source,
      };
      byAccount.set(accountName, draft);
    }

    // Asset class: explicit column wins; otherwise infer for US rows (cash funds vs equity).
    let assetClass: AssetClass;
    if (r.asset_class) assetClass = normAssetClass(r.asset_class)[0];
    else if (looksUS) assetClass = CASH_LIKE.test(`${name} ${r.symbol ?? ""}`) ? "cash" : "us_equity";
    else assetClass = normAssetClass(r.asset_class)[0];

    draft.holdings.push({
      symbol: (r.symbol || r.isin || "").toUpperCase() || undefined,
      name,
      assetClass,
      units: num(r.units ?? r.quantity ?? r.shares),
      marketValue: mv,
      costBasis: num(r.cost_basis ?? r.cost_basis_total),
      buyDate: r.buy_date || undefined,
      currency: (r.currency || draft.account.currency).toUpperCase(),
    });
  }

  if (skipped) warnings.push(`${skipped} row(s) skipped (missing account / name / market value).`);
  return [...byAccount.values()];
}
