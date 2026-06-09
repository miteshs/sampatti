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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const ymd = (y: number, m: number, d: number): string | undefined => {
  if (y < 100) y += y > new Date().getFullYear() % 100 ? 1900 : 2000; // 2-digit year pivot
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

// Broker buy/acquired dates arrive in every shape: ISO, 12/31/2023 (US), 31/12/2023 (India),
// 12-Jan-2023, "Jan 12, 2023", or an Excel serial number (SheetJS hands those through as-is).
// `usHint` settles the ambiguous 03/04/2023 case: month-first for USD rows, day-first otherwise.
export function normDate(v: unknown, usHint = false): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial (days since 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim().replace(/\s+as of.*$/i, "");
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) { // Excel serial that arrived as a string
    const n = Number(s);
    return n > 20000 && n < 80000 ? normDate(n) : undefined;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO already
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/ ]([a-z]{3})[a-z]*[-/, ]+(\d{2,4})$/i); // 12-Jan-2023 / 12 January 2023
  if (m) return MONTHS[m[2].toLowerCase()] ? ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : undefined;
  m = s.match(/^([a-z]{3})[a-z]*[-/ ]+(\d{1,2})[-/, ]+(\d{2,4})$/i); // Jan 12, 2023
  if (m) return MONTHS[m[1].toLowerCase()] ? ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) : undefined;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // 12/31/2023 vs 31/12/2023
  if (m) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    if (a > 12) return ymd(y, b, a); // day-first, unambiguous
    if (b > 12) return ymd(y, a, b); // month-first, unambiguous
    return usHint ? ymd(y, a, b) : ymd(y, b, a);
  }
  return undefined;
}

// Detect the alternative asset classes from a holding's name (e.g. "Blackstone Private Credit
// Fund", "KKR Private Equity", "Marcellus PMS", "… Market Linked Debenture"). Conservative —
// only fires on explicit phrases.
function classFromName(name: string): AssetClass | undefined {
  const n = name.toLowerCase();
  if (/structured note|structured product|market.?linked|equity.?linked note|\bmld\b|\beln\b|autocallable/.test(n)) return "structured_notes";
  if (/private credit|direct lending|private debt|credit fund/.test(n)) return "private_credit";
  if (/private equity|buyout|venture capital|private assets|private markets/.test(n)) return "private_equity";
  if (/\bpms\b|portfolio management service/.test(n)) return "pms";
  return undefined;
}

// Brokerage "Fixed Income" rows that are really market-linked structured notes: a bank-issuer
// financing entity, a "DUE <maturity>", and a VAR/coupon shape (e.g. "MORGAN STANLEY FIN VAR
// 26 DUE 10/09/26", "BNP PARIBAS SA 0% 29F DUE 03/05/29"). Plain Treasuries/munis/corporates
// (no bank-financing issuer) stay fd_rd; ambiguous bank bonds can be reclassified by hand.
function looksLikeStructuredNote(name: string): boolean {
  const n = name.toLowerCase();
  if (!/\bdue\b|\bcalled\b|\beff:/.test(n)) return false; // a maturity / call marker

  const bankIssuer = /\bfin\b|\bfinl\b|fin corp|global ma\b|global markets|bank plc|paribas|barclays|societe generale|credit agricole|\bubs\b|morgan stanley|citigroup global|goldman|gs fin|deutsche|\bhsbc\b|natwest/.test(n);
  const noteShape = /\bvar\b|\d{1,2}(\.\d+)?\s*%|0%/.test(n);
  return bankIssuer && noteShape;
}

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

    // Asset class: explicit column wins; otherwise infer. For USD rows a confident broker
    // "Asset Type" wins; an "Alternative Investments" (or unknown) row falls to a name check
    // for private equity / private credit / PMS, then a cash-fund check, else us_equity.
    // Indian rows: a PMS/PE/PC name wins; else a ticker + units → indian_equity.
    const byName = classFromName(name);
    let assetClass: AssetClass;
    if (r.asset_class) assetClass = normAssetClass(r.asset_class)[0];
    else if (isUsd) {
      const typeKey = (r.asset_type || r.security_type || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const byType = US_ASSET_TYPE[typeKey];
      if (byName) assetClass = byName; // explicit name signal (structured note / PE / PC / PMS)
      else if (byType === "fd_rd" && looksLikeStructuredNote(name)) assetClass = "structured_notes";
      else if (byType && byType !== "other") assetClass = byType;
      else assetClass = byType ?? (CASH_LIKE.test(`${name} ${r.symbol ?? ""}`) ? "cash" : "us_equity");
    } else if (byName) assetClass = byName;
    else if ((r.instrument || r.symbol || r.scrip || r.isin) && num(r.units ?? r.quantity ?? r.qty ?? r.shares ?? r.net)) assetClass = "indian_equity";
    else assetClass = "other";

    const units = num(r.units ?? r.quantity ?? r.qty ?? r.shares ?? r.net_shares ?? r.net);

    // Cost basis: a TOTAL-invested column wins; otherwise a per-unit average cost × units
    // (Fidelity "Average Cost Basis", Zerodha "Avg. cost", Schwab "Cost/Share" are per-unit).
    const totalBasis = num(
      r.cost_basis ?? r.cost_basis_total ?? r.total_cost ?? r.cost_value ?? r.buy_value ??
      r.purchase_value ?? r.purchase_cost ?? r.purchase_amount ?? r.invested ?? r.invested_value ??
      r.invested_amount ?? r.amount_invested ?? r.investment_value ?? r.investment_amount ??
      r.acquisition_cost ?? r.book_value ?? r.book_cost ?? r.cost,
    );
    const perUnit = num(
      r.avg_cost ?? r.average_cost ?? r.avg_cost_basis ?? r.average_cost_basis ?? r.avg_buy_price ??
      r.average_buy_price ?? r.buy_price ?? r.buy_avg ?? r.purchase_price ?? r.cost_price ??
      r.avg_price ?? r.average_price ?? r.avg_nav ?? r.purchase_nav ?? r.cost_share ?? r.cost_per_share,
    );
    let costBasis = totalBasis ?? (perUnit !== undefined && units ? perUnit * units : undefined);
    if (costBasis !== undefined && costBasis <= 0) costBasis = undefined;

    draft.holdings.push({
      symbol: (r.symbol || r.scrip || r.isin || "").toUpperCase() || undefined,
      name,
      assetClass,
      units,
      marketValue: mv,
      costBasis: costBasis !== undefined ? Math.round(costBasis * 100) / 100 : undefined,
      buyDate: normDate(
        r.buy_date || r.date_acquired || r.acquisition_date || r.acquired_date || r.acquired ||
        r.purchase_date || r.date_of_purchase || r.purchased, isUsd,
      ),
      currency: (r.currency || draft.account.currency).toUpperCase(),
    });
  }

  if (skipped) warnings.push(`${skipped} row(s) skipped (missing account / name / market value).`);
  return [...byAccount.values()];
}
