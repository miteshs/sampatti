// XLS/XLSX → ImportDrafts via SheetJS, fully in-browser. We read the first sheet, treat
// the first row as headers, and reuse the same canonical mapping as the CSV path.

import * as XLSX from "xlsx";
import { rowsToDrafts, type Row } from "./rows";
import type { ImportDraft } from "../domain/types";

export function parseXlsx(data: ArrayBuffer, source = "xlsx"): ImportDraft[] {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
  return rowsToDrafts(rows, source);
}

// Flatten the first sheet to CSV text — used to hand a spreadsheet to Claude when local
// parsing can't recognize its layout.
export function xlsxToCsv(data: ArrayBuffer): string {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
}
