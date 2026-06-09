// XLS/XLSX → ImportDrafts via SheetJS, fully in-browser. We scan every sheet (real exports
// often put the data behind a summary/cover sheet) and use the one that yields the most
// holdings, treating its first row as headers and reusing the canonical CSV mapping.

import * as XLSX from "xlsx";
import { rowsToDrafts, type Row } from "./rows";
import type { ImportDraft } from "../domain/types";

const sheetRows = (wb: XLSX.WorkBook, name: string): Row[] => {
  const sheet = wb.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false }) : [];
};

export function parseXlsx(data: ArrayBuffer, source = "xlsx"): ImportDraft[] {
  const wb = XLSX.read(data, { type: "array" });
  let best: ImportDraft[] = [];
  let bestCount = 0;
  for (const name of wb.SheetNames) {
    const drafts = rowsToDrafts(sheetRows(wb, name), source);
    const count = drafts.reduce((n, d) => n + d.holdings.length, 0);
    if (count > bestCount) { best = drafts; bestCount = count; }
  }
  return best;
}

// Flatten every sheet to labeled CSV text — used to hand a spreadsheet to Claude when local
// parsing can't recognize its layout.
export function xlsxToCsv(data: ArrayBuffer): string {
  const wb = XLSX.read(data, { type: "array" });
  return wb.SheetNames
    .map((name) => {
      const sheet = wb.Sheets[name];
      return sheet ? `# ${name}\n${XLSX.utils.sheet_to_csv(sheet)}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
