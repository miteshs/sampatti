// Shared "2D grid → ImportDrafts" logic for CSV and XLSX. Real broker exports rarely put the
// column header on the first row — there's a title/preamble (Indian demat "Holding Statement"),
// or several account sections stacked in one file (Schwab "All-Accounts"). Both the CSV parser
// (PapaParse rows) and the XLSX parser (SheetJS rows) hand their grid here so header detection
// and account splitting live in one place.

import { rowsToDrafts, type Row } from "./rows";
import type { ImportDraft } from "../domain/types";

export type Cell = string | number | null | undefined;
export type Grid = Cell[][];

const cell = (c: Cell) => String(c ?? "").trim();

// Header-cell normalizer mirroring rows.ts `lower()` (drop parentheticals, then snake_case).
const normHeader = (c: Cell) =>
  cell(c).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const NAME_HEADERS = new Set([
  "symbol", "description", "name", "security", "instrument", "scheme_name",
  "scheme", "stock", "isin", "scrip",
]);
const VALUE_HEADERS = new Set([
  "market_value", "value", "amount", "current_value", "cur_val", "closing_value",
  "market_val", "mkt_val", "est_market_value", "balance",
]);

// A header row both names a security and carries a value column — the signature of a holdings
// table (vs a title line, a section label, or a summary/footer row).
const isHeaderRow = (cells: Cell[]): boolean => {
  const keys = cells.map(normHeader);
  return keys.some((k) => NAME_HEADERS.has(k)) && keys.some((k) => VALUE_HEADERS.has(k));
};

// Summary/footer rows that repeat a section's total and must not become a holding.
const SUMMARY_FIRST_CELL = /^(positions?\s+total|account\s+total|grand\s+total|total)$/i;

const isBlank = (cells: Cell[]) => cells.every((c) => cell(c) === "");
const meaningful = (cells: Cell[]) => cells.filter((c) => cell(c) !== "");
const isSummary = (cells: Cell[]) => SUMMARY_FIRST_CELL.test(cell(cells[0]));

// Map a data row onto a header row, producing the loose record rowsToDrafts expects. Blank
// header cells are dropped so unlabeled spacer columns don't collide.
function toRow(header: Cell[], cells: Cell[], extra?: Record<string, string>): Row {
  const obj: Row = {};
  header.forEach((h, i) => { const k = cell(h); if (k) obj[k] = cells[i] ?? ""; });
  if (extra) Object.assign(obj, extra);
  return obj;
}

// Charles Schwab–style "All Accounts" exports stack account sections: a bare account-name line,
// a repeated column header, holdings, then a "Positions Total" line. Walk the grid, tagging each
// holding with the account whose section it's in.
function sectioned(grid: Grid, source: string): ImportDraft[] {
  const rows: Row[] = [];
  let pendingLabel: string | null = null;
  let header: Cell[] | null = null;
  let labelKey = ""; // header field to stash the account under (empty ⇒ a real account col exists)

  for (const cells of grid) {
    if (isBlank(cells)) continue;
    if (isHeaderRow(cells)) {
      header = cells;
      labelKey = cells.map(normHeader).some((k) => k === "account" || k === "account_name") ? "" : "account";
      continue;
    }
    const only = meaningful(cells);
    if (only.length === 1) {
      // A standalone label line opens a new section and closes the previous one.
      pendingLabel = cell(only[0]);
      header = null;
      continue;
    }
    if (!header || isSummary(cells)) continue; // stray/summary row — ignore
    rows.push(toRow(header, cells, labelKey && pendingLabel ? { [labelKey]: pendingLabel } : undefined));
  }
  return rowsToDrafts(rows, source);
}

// Entry point: turn any parsed grid into drafts. Two or more holdings-header rows ⇒ a stacked
// multi-account export; otherwise a single table whose header may sit below a title/preamble.
export function gridToDrafts(grid: Grid, source: string): ImportDraft[] {
  const headerIdxs: number[] = [];
  grid.forEach((r, i) => { if (isHeaderRow(r)) headerIdxs.push(i); });
  if (headerIdxs.length >= 2) return sectioned(grid, source);

  const h = headerIdxs.length === 1 ? headerIdxs[0] : 0;
  const header = grid[h] ?? [];
  const rows: Row[] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells || isBlank(cells) || isSummary(cells)) continue;
    rows.push(toRow(header, cells));
  }
  return rowsToDrafts(rows, source);
}
