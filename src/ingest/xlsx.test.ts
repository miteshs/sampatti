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

  it("parses an ESPP stock-plan sheet (Est. Market Value / Net Shares, $ only in FMV cols)", () => {
    const ab = makeXlsx([
      ["Record Type", "Symbol", "Purchase Date", "Net Shares", "Est. Market Value", "Grant Date FMV"],
      ["Purchase", "ACME", "31-AUG-2020", 100, 12000, "$45.64"],
      ["Purchase", "ACME", "28-FEB-2021", 50, 6000, "$50.00"],
      ["Totals", "", "", 150, 18000, ""],
    ], "ESPP");
    const drafts = parseXlsx(ab, "ByBenefitType.xlsx");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].holdings).toHaveLength(2); // two lots, Totals row dropped
    expect(drafts[0].account.currency).toBe("USD");
    expect(drafts[0].holdings[0].marketValue).toBe(12000);
    expect(drafts[0].holdings[0].units).toBe(100);
    expect(drafts[0].holdings.every((h) => h.assetClass === "us_equity")).toBe(true);
  });

  it("finds the header below a title/preamble in the SAME sheet (Indian Holding Statement)", () => {
    const ab = makeXlsx([
      ["Holding Statement", "", "", ""],
      ["", "", "", ""],
      ["Scrip", "Name", "Net", "Market Value"],
      ["ZEBRAINFRA", "ZEBRA INFRA LTD", 100, 25000],
      ["MANGOFOODS", "MANGO FOODS LTD", 40, 20000],
      ["", "", "", 45000], // totals row — no name, dropped
    ], "Report");
    const drafts = parseXlsx(ab, "HoldingStatement.xlsx");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].holdings.map((h) => h.symbol)).toEqual(["ZEBRAINFRA", "MANGOFOODS"]);
    expect(drafts[0].holdings[0].units).toBe(100);
    expect(drafts[0].account.currency).toBe("INR");
    expect(drafts[0].holdings.every((h) => h.assetClass === "indian_equity")).toBe(true);
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
