// CSV → ImportDrafts. Parsing is done entirely in the browser (PapaParse); the file is
// never uploaded anywhere. We parse to a raw grid (no assumed header row) and hand it to
// gridToDrafts, which finds the header — skipping any title/preamble — and splits stacked
// multi-account exports.

import Papa from "papaparse";
import { gridToDrafts, type Grid } from "./grid";
import type { ImportDraft } from "../domain/types";

export function parseCsv(text: string, source = "csv"): ImportDraft[] {
  const grid = (Papa.parse<string[]>(text, { header: false, skipEmptyLines: false }).data ?? []).filter(Array.isArray);
  return gridToDrafts(grid as Grid, source);
}
