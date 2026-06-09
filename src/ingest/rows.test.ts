import { describe, expect, it } from "vitest";
import { normDate, rowsToDrafts } from "./rows";

describe("normDate — broker date shapes → YYYY-MM-DD", () => {
  it("passes ISO through", () => {
    expect(normDate("2023-07-12")).toBe("2023-07-12");
    expect(normDate("2023-7-2")).toBe("2023-07-02");
  });
  it("reads US month-first when the row is USD-hinted", () => {
    expect(normDate("12/31/2023", true)).toBe("2023-12-31");
    expect(normDate("03/04/2023", true)).toBe("2023-03-04"); // ambiguous → month-first
  });
  it("reads Indian day-first by default", () => {
    expect(normDate("31/12/2023")).toBe("2023-12-31");
    expect(normDate("03/04/2023")).toBe("2023-04-03"); // ambiguous → day-first
    expect(normDate("03-04-2023")).toBe("2023-04-03");
  });
  it("reads named months in both orders", () => {
    expect(normDate("12-Jan-2023")).toBe("2023-01-12");
    expect(normDate("12 January 2023")).toBe("2023-01-12");
    expect(normDate("Jan 12, 2023")).toBe("2023-01-12");
  });
  it("converts Excel serial dates (number or numeric string)", () => {
    expect(normDate(45123)).toBe("2023-07-16");
    expect(normDate("45123")).toBe("2023-07-16");
  });
  it("expands 2-digit years on the right side of the century", () => {
    expect(normDate("12/31/19", true)).toBe("2019-12-31");
    expect(normDate("12/31/99", true)).toBe("1999-12-31");
  });
  it("rejects junk without throwing", () => {
    expect(normDate("--")).toBeUndefined();
    expect(normDate("n/a")).toBeUndefined();
    expect(normDate("")).toBeUndefined();
    expect(normDate(undefined)).toBeUndefined();
    expect(normDate("13/13/2023")).toBeUndefined();
    expect(normDate("2023")).toBeUndefined(); // a bare year is not a date
  });
});

describe("rowsToDrafts — cost basis & buy date capture", () => {
  it("takes a total-invested column directly (Zerodha 'Buy Value')", () => {
    const [d] = rowsToDrafts(
      [{ Instrument: "RELIANCE", Qty: "10", "Cur. val": "35000", "Buy Value": "21,000" }],
      "holdings.csv",
    );
    expect(d.holdings[0].costBasis).toBe(21000);
  });

  it("multiplies a per-unit average cost by units (Fidelity 'Average Cost Basis')", () => {
    const [d] = rowsToDrafts(
      [{
        Symbol: "MSFT", Description: "MICROSOFT CORP", Quantity: "10",
        "Current Value": "$4,300", "Average Cost Basis": "$300",
      }],
      "fidelity.csv",
    );
    expect(d.holdings[0].costBasis).toBe(3000);
    expect(d.account.currency).toBe("USD");
  });

  it("prefers the total column when both total and per-unit exist", () => {
    const [d] = rowsToDrafts(
      [{
        Symbol: "MSFT", Description: "MICROSOFT CORP", Quantity: "10",
        "Current Value": "$4,300", "Cost Basis": "$3,100", "Cost/Share": "$300",
      }],
      "schwab.csv",
    );
    expect(d.holdings[0].costBasis).toBe(3100);
  });

  it("normalizes 'Date Acquired' month-first on a USD row", () => {
    const [d] = rowsToDrafts(
      [{
        Symbol: "AAPL", Description: "APPLE INC", Quantity: "5",
        "Current Value": "$1,000", "Date Acquired": "02/15/2022",
      }],
      "lots.csv",
    );
    expect(d.holdings[0].buyDate).toBe("2022-02-15");
  });

  it("normalizes an Indian day-first purchase date", () => {
    const [d] = rowsToDrafts(
      [{ account: "Demat", name: "TCS", units: "5", market_value: "18000", "Purchase Date": "15/02/2022" }],
      "demat.csv",
    );
    expect(d.holdings[0].buyDate).toBe("2022-02-15");
  });

  it("leaves basis/date undefined when absent or placeholder", () => {
    const [d] = rowsToDrafts(
      [{ account: "Demat", name: "TCS", market_value: "18000", "Cost Basis": "--", "Date Acquired": "N/A" }],
      "x.csv",
    );
    expect(d.holdings[0].costBasis).toBeUndefined();
    expect(d.holdings[0].buyDate).toBeUndefined();
  });

  it("ignores a zero/negative basis", () => {
    const [d] = rowsToDrafts(
      [{ account: "Demat", name: "TCS", market_value: "18000", invested: "0" }],
      "x.csv",
    );
    expect(d.holdings[0].costBasis).toBeUndefined();
  });
});
