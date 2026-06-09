// CSV → ImportDrafts. Parsing is done entirely in the browser (PapaParse); the file is
// never uploaded anywhere.

import Papa from "papaparse";
import { rowsToDrafts, type Row } from "./rows";
import type { ImportDraft } from "../domain/types";

export function parseCsv(text: string, source = "csv"): ImportDraft[] {
  const res = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  return rowsToDrafts(res.data ?? [], source);
}
