import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx, xlsxToCsv } from "./xlsx";

// Build an .xlsx as an ArrayBuffer — exactly what File.arrayBuffer() hands the app.
function makeXlsx(rows: (string | number)[][], sheetName = "Sheet1"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  // type:"array" returns an ArrayBuffer — exactly what File.arrayBuffer() gives the app.
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseXlsx", () => {
  it("parses a holdings spreadsheet from an ArrayBuffer", () => {
    const ab = makeXlsx([
      ["account", "name", "market_value", "currency"],
      ["My Demat", "Reliance Industries", 300000, "INR"],
      ["My Demat", "Infosys", 80000, "INR"],
    ]);
    const drafts = parseXlsx(ab, "holdings.xlsx");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].holdings).toHaveLength(2);
    expect(drafts[0].holdings[0].marketValue).toBe(300000);
  });

  it("returns no holdings for a non-portfolio sheet (so the UI offers Claude)", () => {
    const ab = makeXlsx([
      ["Benefit Type", "Coverage", "Election"],
      ["Medical", "Family", "Yes"],
      ["Dental", "Self", "No"],
    ]);
    expect(parseXlsx(ab, "ByBenefitType.xlsx").reduce((n, d) => n + d.holdings.length, 0)).toBe(0);
  });

  it("flattens a sheet to CSV text for the Claude fallback", () => {
    const ab = makeXlsx([["Benefit Type", "Amount"], ["Medical", 1200]]);
    expect(xlsxToCsv(ab)).toMatch(/Benefit Type.*\n.*Medical/);
  });

  it("finds the data sheet even when the first sheet is a cover/summary", () => {
    const ws1 = XLSX.utils.aoa_to_sheet([["Summary"], ["Generated", "2026-06-09"]]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["account", "name", "market_value"],
      ["My Demat", "TCS", 150000],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Cover");
    XLSX.utils.book_append_sheet(wb, ws2, "Holdings");
    const ab = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const drafts = parseXlsx(ab, "multi.xlsx");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].holdings[0].name).toBe("TCS");
  });
});
