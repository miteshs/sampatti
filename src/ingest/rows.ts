// The canonical "Sampatti CSV/sheet" row shape and its mapping into ImportDrafts.
// A TS port of tally/backend/app/importers/csv_import.py, with India columns. One row per
// holding; rows sharing an `account` become one account (its meta comes from the first row).
//
//   account,institution,account_type,tax_treatment,region,currency,symbol,name,
//   asset_class,units,market_value,cost_basis,buy_date,as_of
//
// Only `account`, `name`, and `market_value` are required.

import { normAccountType, normAssetClass, normRegion, normTaxTreatment } from "../domain/classify";
import type { ImportDraft } from "../domain/types";

export type Row = Record<string, string>;

export function num(s: string | undefined): number | undefined {
  const t = (s ?? "").replace(/[₹$,\s]/g, "").trim();
  if (t === "" || ["--", "n/a", "na", "none"].includes(t.toLowerCase())) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

// Lowercase + trim header keys so "Market Value", "market_value", "MARKET VALUE" all match.
function lower(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[(k ?? "").trim().toLowerCase().replace(/\s+/g, "_")] = (v ?? "").trim();
  return out;
}

export function rowsToDrafts(rawRows: Row[], source: string): ImportDraft[] {
  const byAccount = new Map<string, ImportDraft>();
  const warnings: string[] = [];
  let skipped = 0;

  for (const raw of rawRows) {
    const r = lower(raw);
    const accountName = r.account || r.account_name;
    const name = r.name || r.security || r.symbol;
    const mv = num(r.market_value ?? r.value ?? r.amount);
    if (!accountName || !name || mv === undefined || mv === 0) {
      skipped += 1;
      continue;
    }

    let draft = byAccount.get(accountName);
    if (!draft) {
      const currency = (r.currency || "INR").toUpperCase();
      draft = {
        account: {
          name: accountName,
          institution: r.institution || "Manual",
          accountType: normAccountType(r.account_type)[0],
          taxTreatment: normTaxTreatment(r.tax_treatment ?? r.tax_status)[0],
          region: normRegion(r.region)[0],
          currency,
          asOf: r.as_of || undefined,
        },
        holdings: [],
        warnings,
        source,
      };
      byAccount.set(accountName, draft);
    }

    draft.holdings.push({
      symbol: (r.symbol || r.isin || "").toUpperCase() || undefined,
      name,
      assetClass: normAssetClass(r.asset_class)[0],
      units: num(r.units ?? r.quantity),
      marketValue: mv,
      costBasis: num(r.cost_basis),
      buyDate: r.buy_date || undefined,
      currency: (r.currency || draft.account.currency).toUpperCase(),
    });
  }

  if (skipped) warnings.push(`${skipped} row(s) skipped (missing account / name / market value).`);
  return [...byAccount.values()];
}
