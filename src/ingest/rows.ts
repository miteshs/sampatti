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

// Normalize header keys so "Market Value", "market_value", "MARKET VALUE", "Cur. val",
// and "Qty." all collapse to comparable snake_case keys (punctuation → underscore). A
// parenthetical qualifier is dropped first, so Schwab's "Mkt Val (Market Value)" → "mkt_val"
// and "Qty (Quantity)" → "qty" rather than a run-on key that matches nothing.
const PLACEHOLDER = new Set(["", "-", "--", "n/a", "na", "none"]);
function lower(row: Row): Lowered {
  const out: Lowered = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k ?? "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!key) continue;
    // Treat broker placeholder dashes ("--", "N/A") as empty so a "--" Description doesn't
    // win over the real label, and so they never leak into names/symbols/currencies.
    const val = String(v ?? "").trim();
    out[key] = PLACEHOLDER.has(val.toLowerCase()) ? "" : val;
  }
  return out;
}

const CASH_LIKE = /money market|fdic|treasury only|cash reserves|cash & cash|cash investment|SPAXX|FDRXX|FZFXX|SWVXX|VMFXX|SNSXX/i;

// US broker "Asset Type"/"Security Type" column → our asset class. Used only for USD rows;
// keeps a Schwab "All Accounts" export from dumping bonds, cash and alts into "US Equity".
// (Keys are header-normalized, e.g. "ETFs & Closed End Funds" → "etfs_closed_end_funds".)
const US_ASSET_TYPE: Record<string, AssetClass> = {
  equity: "us_equity",
  etfs_closed_end_funds: "index_etf",
  etf: "index_etf",
  fixed_income: "fd_rd",
  cash_and_money_market: "cash",
  mutual_fund: "equity_mf",
  alternative_investments: "other",
};

export function rowsToDrafts(rawRows: Row[], source: string): ImportDraft[] {
  const byAccount = new Map<string, ImportDraft>();
  const warnings: string[] = [];
  let skipped = 0;

  // If the file has NO account column at all (many single-account broker exports), fall back
  // to a name derived from the filename. If it HAS an account column, a blank in a row is an
  // orphan and gets skipped as before.
  const firstKeys = rawRows.length ? lower(rawRows[0]) : {};
  const hasAccountCol = ["account", "account_name", "account_number"].some((k) => k in firstKeys);
  const fallbackAccount = (source || "Imported account").replace(/\.[a-z0-9]+$/i, "").replace(/[_\-]+/g, " ").trim() || "Imported account";

  for (const raw of rawRows) {
    const r = lower(raw);
    const accountName = r.account || r.account_name || r.account_number || (hasAccountCol ? "" : fallbackAccount);
    const name = r.name || r.description || r.security || r.instrument || r.scheme_name || r.scheme || r.stock || r.symbol;
    const rawMv = String(r.market_value ?? r.value ?? r.amount ?? r.current_value ?? r.cur_val ?? r.closing_value ?? r.market_val ?? r.mkt_val ?? r.est_market_value ?? "");
    const mv = num(rawMv);
    if (!accountName || !name || mv === undefined || mv === 0) {
      skipped += 1;
      continue;
    }

    // Detect USD from the data itself — an explicit currency, or a $ anywhere in the row.
    // (Indian statements also have a "Current Value" column, so column names alone aren't
    // enough; and some US exports — e.g. ESPP sheets — put $ only in a per-share FMV column,
    // not the market-value cell, so we scan the whole row rather than just the value.)
    const rowCcy = r.currency ? r.currency.toUpperCase() : "";
    const isUsd = rowCcy === "USD" || (!rowCcy && Object.values(r).some((v) => v.includes("$")));

    let draft = byAccount.get(accountName);
    if (!draft) {
      draft = {
        account: {
          name: accountName,
          institution: r.institution || (isUsd ? "US Broker" : "Manual"),
          accountType: r.account_type ? normAccountType(r.account_type)[0] : isUsd ? "foreign_broker" : "demat",
          taxTreatment: normTaxTreatment(r.tax_treatment ?? r.tax_status)[0],
          region: r.region ? normRegion(r.region)[0] : isUsd ? "US" : "India",
          currency: rowCcy || (isUsd ? "USD" : "INR"),
          asOf: r.as_of || undefined,
        },
        holdings: [],
        warnings,
        source,
      };
      byAccount.set(accountName, draft);
    }

    // Asset class: explicit column wins; otherwise infer. For USD rows we prefer the broker's
    // "Asset Type" column (bonds/cash/ETFs/alts), then a cash-fund name check, else us_equity.
    // Indian demat rows with a ticker + units → indian_equity.
    let assetClass: AssetClass;
    if (r.asset_class) assetClass = normAssetClass(r.asset_class)[0];
    else if (isUsd) {
      const typeKey = (r.asset_type || r.security_type || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const byType = US_ASSET_TYPE[typeKey];
      assetClass = byType ?? (CASH_LIKE.test(`${name} ${r.symbol ?? ""}`) ? "cash" : "us_equity");
    } else if ((r.instrument || r.symbol || r.scrip || r.isin) && num(r.units ?? r.quantity ?? r.qty ?? r.shares ?? r.net)) assetClass = "indian_equity";
    else assetClass = "other";

    draft.holdings.push({
      symbol: (r.symbol || r.scrip || r.isin || "").toUpperCase() || undefined,
      name,
      assetClass,
      units: num(r.units ?? r.quantity ?? r.qty ?? r.shares ?? r.net_shares ?? r.net),
      marketValue: mv,
      costBasis: num(r.cost_basis ?? r.cost_basis_total ?? r.invested ?? r.amount_invested),
      buyDate: r.buy_date || undefined,
      currency: (r.currency || draft.account.currency).toUpperCase(),
    });
  }

  if (skipped) warnings.push(`${skipped} row(s) skipped (missing account / name / market value).`);
  return [...byAccount.values()];
}
