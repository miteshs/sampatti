import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

const CSV = `account,institution,account_type,tax_treatment,region,currency,symbol,name,asset_class,units,market_value,cost_basis,buy_date,as_of
Zerodha,Zerodha,demat,taxable,India,INR,RELIANCE,Reliance Industries,stock,1180,"35,00,000",2100000,2019-07-12,2026-05-31
Zerodha,Zerodha,demat,taxable,India,INR,INFY,Infosys,equity,1400,2200000,,2018-11-05,2026-05-31
PPF,SBI,epf_ppf,exempt,India,INR,,PPF account,ppf,,2800000,,,2026-03-31
,,,,,,,Orphan row,equity,,500000,,,
Bad,Bad,bank,taxable,India,INR,,No value row,cash,,,,,`;

describe("parseCsv (canonical Sampatti CSV)", () => {
  const drafts = parseCsv(CSV);

  it("groups rows into accounts (and drops accounts with no valid holdings)", () => {
    // "Bad" has only a value-less row, so it never materializes as an account.
    expect(drafts.map((d) => d.account.name).sort()).toEqual(["PPF", "Zerodha"]);
  });

  it("normalizes loose asset-class and tax aliases", () => {
    const z = drafts.find((d) => d.account.name === "Zerodha")!;
    expect(z.holdings.map((h) => h.assetClass)).toEqual(["indian_equity", "indian_equity"]);
    const ppf = drafts.find((d) => d.account.name === "PPF")!;
    expect(ppf.account.taxTreatment).toBe("eee_exempt");
    expect(ppf.holdings[0].assetClass).toBe("epf_ppf");
  });

  it("parses Indian lakh-grouped and quoted numbers", () => {
    const z = drafts.find((d) => d.account.name === "Zerodha")!;
    expect(z.holdings[0].marketValue).toBe(3_500_000);
  });

  it("skips rows missing account, name, or value", () => {
    // The orphan row (no account) and the no-value "Bad" row are dropped entirely.
    expect(drafts.find((d) => d.account.name === "Bad")).toBeUndefined();
    const all = drafts.flatMap((d) => d.holdings);
    expect(all.find((h) => h.name === "Orphan row")).toBeUndefined();
    expect(all.find((h) => h.name === "No value row")).toBeUndefined();
  });

  it("carries buy dates and statement dates through", () => {
    const z = drafts.find((d) => d.account.name === "Zerodha")!;
    expect(z.holdings[0].buyDate).toBe("2019-07-12");
    expect(z.account.asOf).toBe("2026-05-31");
  });
});

// Fidelity "Portfolio_Positions_*.csv": different headers, $ values, no currency column,
// and trailing disclaimer rows of uneven width (which used to crash the parser).
const FIDELITY_CSV = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Type
Z12345678,Individual,AAPL,APPLE INC,100,$220.00,"$22,000.00","$15,000.00",Cash
Z12345678,Individual,SPAXX,FIDELITY GOVERNMENT MONEY MARKET,5000,$1.00,"$5,000.00",--,Cash
Z12345678,Individual,VTI,VANGUARD TOTAL STOCK MARKET ETF,50,$280.00,"$14,000.00","$9,000.00",Cash

"Brokerage services are provided by Fidelity Brokerage Services LLC, Member NYSE, SIPC."
"Date downloaded 06/07/2026"`;

describe("parseCsv (Fidelity US brokerage export)", () => {
  const drafts = parseCsv(FIDELITY_CSV, "Portfolio_Positions_Jun-07-2026.csv");

  it("does not crash on uneven disclaimer rows and parses the account", () => {
    expect(drafts).toHaveLength(1);
    expect(drafts[0].account.name).toBe("Individual");
  });

  it("detects USD currency and US region (no currency column present)", () => {
    expect(drafts[0].account.currency).toBe("USD");
    expect(drafts[0].account.region).toBe("US");
    expect(drafts[0].account.accountType).toBe("foreign_broker");
    expect(drafts[0].holdings.every((h) => h.currency === "USD")).toBe(true);
  });

  it("maps Current Value / Description / Quantity and reads $-formatted numbers", () => {
    const aapl = drafts[0].holdings.find((h) => h.symbol === "AAPL")!;
    expect(aapl.name).toBe("APPLE INC");
    expect(aapl.marketValue).toBe(22_000);
    expect(aapl.units).toBe(100);
    expect(aapl.costBasis).toBe(15_000);
    expect(aapl.assetClass).toBe("us_equity");
  });

  it("recognizes a money-market core position as cash, not equity", () => {
    const spaxx = drafts[0].holdings.find((h) => h.symbol === "SPAXX")!;
    expect(spaxx.assetClass).toBe("cash");
  });

  it("drops the trailing disclaimer rows", () => {
    expect(drafts[0].holdings).toHaveLength(3); // AAPL, SPAXX, VTI — no disclaimer junk
  });
});
