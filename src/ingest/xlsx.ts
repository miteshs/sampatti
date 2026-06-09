// XLS/XLSX → ImportDrafts via SheetJS, fully in-browser. We scan every sheet (real exports
// often put the data behind a summary/cover sheet, or a title/preamble above the header) and
// use the one that yields the most holdings. Each sheet is read as a raw grid and handed to
// gridToDrafts, which locates the header row and splits stacked multi-account exports.

import * as XLSX from "xlsx";
import { gridToDrafts, type Grid } from "./grid";
import type { ImportDraft } from "../domain/types";

const sheetGrid = (wb: XLSX.WorkBook, name: string): Grid => {
  const sheet = wb.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json<Grid[number]>(sheet, { header: 1, defval: "", raw: false, blankrows: false }) : [];
};

export function parseXlsx(data: ArrayBuffer, source = "xlsx"): ImportDraft[] {
  const wb = XLSX.read(data, { type: "array" });
  let best: ImportDraft[] = [];
  let bestCount = 0;
  for (const name of wb.SheetNames) {
    const drafts = gridToDrafts(sheetGrid(wb, name), source);
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
