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

// A single-account Indian broker export (Zerodha-style): no account column, punctuated
// headers (Qty., Cur. val), lakh-grouped values.
const ZERODHA_CSV = `Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L
RELIANCE,100,2100,3000,"3,00,000",90000
INFY,50,1200,1600,"80,000",20000`;

describe("parseCsv (broker export with no account column)", () => {
  const drafts = parseCsv(ZERODHA_CSV, "Zerodha_Holdings.csv");

  it("falls back to a filename-derived account and parses the holdings", () => {
    expect(drafts).toHaveLength(1);
    expect(drafts[0].account.name).toBe("Zerodha Holdings");
    expect(drafts[0].holdings.map((h) => h.name)).toEqual(["RELIANCE", "INFY"]);
  });

  it("maps punctuated headers Qty./Cur. val and lakh-grouped values", () => {
    const rel = drafts[0].holdings[0];
    expect(rel.units).toBe(100);
    expect(rel.marketValue).toBe(300000);
    expect(rel.assetClass).toBe("indian_equity"); // inferred: ticker + units, non-US
  });
});

describe("currency detection is value-based, not column-name-based", () => {
  it("keeps an Indian statement INR even when it has a 'Current Value' column", () => {
    const csv = `Scheme Name,Units,Current Value\nParag Parikh Flexi Cap,5000,"4,27,510.00"`;
    const drafts = parseCsv(csv, "mf.csv");
    expect(drafts[0].account.currency).toBe("INR");
    expect(drafts[0].holdings[0].currency).toBe("INR");
  });

  it("detects USD from a $ in the value, with no currency column", () => {
    const csv = `Symbol,Description,Current Value\nAAPL,APPLE INC,"$22,000.00"`;
    const drafts = parseCsv(csv, "us.csv");
    expect(drafts[0].account.currency).toBe("USD");
    expect(drafts[0].account.region).toBe("US");
  });
});

// Charles Schwab "Positions for All-Accounts" export: a title line, then several account
// SECTIONS — each a bare account-label line, a repeated column header (with parenthetical
// qualifiers), holdings, a real cash sweep, and a "Positions Total" subtotal to discard.
const SCHWAB_ALL_ACCOUNTS = `"Positions for All-Accounts as of 04:00 PM ET, 01/02/2026"


Taxable_Brokerage ...111
"Symbol","Description","Price","Qty (Quantity)","Mkt Val (Market Value)","Cost Basis","Asset Type",
"ACME","ACME CORP","100.00","50","$5,000.00","$4,000.00","Equity",
"BNDX","SAMPLE TOTAL BOND ETF","50.00","100","$5,000.00","$5,200.00","ETFs & Closed End Funds",
"Cash & Cash Investments","--","--","--","$1,000.00","--","Cash and Money Market",
"Positions Total","","--","--","$11,000.00","$9,200.00","--",


Retirement_IRA ...222
"Symbol","Description","Price","Qty (Quantity)","Mkt Val (Market Value)","Cost Basis","Asset Type",
"99XYZ1234","SAMPLE BANK 0% DUE 2030","100.00","10,000","$10,000.00","$10,000.00","Fixed Income",
"PRIVCO","SAMPLE PRIVATE FUND CLASS I","20.00","500","$10,000.00","$9,000.00","Alternative Investments",
"Positions Total","","--","--","$20,000.00","$19,000.00","--",


Empty_Account ...333
"Symbol","Description","Price","Qty (Quantity)","Mkt Val (Market Value)","Cost Basis","Asset Type",
"Cash & Cash Investments","--","--","--","$0.00","--","Cash and Money Market",
"Positions Total","","--","--","$0.00","--","--",`;

describe("parseCsv (Schwab multi-account 'All-Accounts' export)", () => {
  const drafts = parseCsv(SCHWAB_ALL_ACCOUNTS, "All-Accounts-Positions.csv");

  it("splits the sections into separate accounts (and drops the empty one)", () => {
    expect(drafts.map((d) => d.account.name)).toEqual(["Taxable_Brokerage ...111", "Retirement_IRA ...222"]);
  });

  it("keeps each account's holdings under that account — no cross-account merge", () => {
    const tax = drafts.find((d) => d.account.name.startsWith("Taxable"))!;
    const ira = drafts.find((d) => d.account.name.startsWith("Retirement"))!;
    expect(tax.holdings.map((h) => h.symbol).slice(0, 2)).toEqual(["ACME", "BNDX"]);
    expect(tax.holdings).toHaveLength(3); // ACME, BNDX, and the cash sweep
    expect(ira.holdings.map((h) => h.symbol)).toEqual(["99XYZ1234", "PRIVCO"]);
  });

  it("discards the 'Positions Total' subtotal rows (no double counting)", () => {
    const all = drafts.flatMap((d) => d.holdings);
    expect(all.some((h) => /^positions?\s+total$/i.test(h.name))).toBe(false);
    const tax = drafts.find((d) => d.account.name.startsWith("Taxable"))!;
    expect(tax.holdings.reduce((s, h) => s + h.marketValue, 0)).toBe(11_000); // == the dropped subtotal
  });

  it("detects USD/US and maps the Asset Type column to real classes", () => {
    const tax = drafts.find((d) => d.account.name.startsWith("Taxable"))!;
    const ira = drafts.find((d) => d.account.name.startsWith("Retirement"))!;
    expect(tax.account.currency).toBe("USD");
    expect(tax.account.region).toBe("US");
    expect(tax.holdings.find((h) => h.symbol === "ACME")!.assetClass).toBe("us_equity");
    expect(tax.holdings.find((h) => h.symbol === "BNDX")!.assetClass).toBe("index_etf");
    expect(tax.holdings.find((h) => h.name === "Cash & Cash Investments")!.assetClass).toBe("cash");
    expect(ira.holdings.find((h) => h.symbol === "99XYZ1234")!.assetClass).toBe("fd_rd"); // Fixed Income
    expect(ira.holdings.find((h) => h.symbol === "PRIVCO")!.assetClass).toBe("other"); // Alternative Investments
  });
});

// An ESPP / stock-plan export: a "Record Type" column, holding value in "Est. Market Value",
// share count in "Net Shares", and the only $ signs in per-share FMV columns (not the value).
const ESPP_CSV = `Record Type,Symbol,Purchase Date,Purchase Price,Purchased Qty.,Net Shares,Est. Market Value,Grant Date FMV,Purchase Date FMV,Discount Percent
Purchase,ACME,31-AUG-2020,38.79,100,100,12000.00,$45.64,$59.29,15%
Purchase,ACME,28-FEB-2021,40.00,50,50,6000.00,$50.00,$62.00,15%
Totals,,,,,150,18000.00,,,`;

describe("parseCsv (ESPP / stock-plan export)", () => {
  const drafts = parseCsv(ESPP_CSV, "StockPlan.csv");

  it("maps 'Est. Market Value' and 'Net Shares', and drops the Totals row", () => {
    expect(drafts).toHaveLength(1);
    const h = drafts[0].holdings;
    expect(h).toHaveLength(2); // two purchase lots, no Totals row
    expect(h[0].marketValue).toBe(12_000);
    expect(h[0].units).toBe(100);
  });

  it("detects USD from a $ in a non-value column (per-share FMV)", () => {
    expect(drafts[0].account.currency).toBe("USD");
    expect(drafts[0].account.region).toBe("US");
    expect(drafts[0].holdings.every((h) => h.assetClass === "us_equity")).toBe(true);
  });
});

// A CDSL/NSDL demat "Holding Statement": a title + blank line above the real header, a blank
// spacer column, "Scrip"/"Net" instead of Symbol/Quantity, and a trailing totals row.
const DEMAT_HOLDING = `Holding Statement,,,,,,,,,,,,,
,,,,,,,,,,,,,
Scrip,Name,,ISIN,Collateral,Broker Beneficiary,Depository,Inward Short,OutWard Short,Net,Previous Day Closing Price,Market Value,%,Sector
ZEBRAINFRA,ZEBRA INFRA LTD,,INE000A01001,0,0,100,0,0,100,250.00,25000,55.55,Infrastructure
MANGOFOODS,MANGO FOODS LTD,,INE000A01002,0,0,40,0,0,40,500.00,20000,44.44,FMCG
TIGERSTEEL,TIGER STEEL LTD,,INE000A01003,0,0,10,0,0,10,0,0,0,Metals
,,,,,,,,,,,45000,100.00,`;

describe("parseCsv (Indian demat Holding Statement)", () => {
  const drafts = parseCsv(DEMAT_HOLDING, "HoldingStatement.xlsx.csv");

  it("finds the header below the title/preamble and maps Scrip/Net/Market Value", () => {
    expect(drafts).toHaveLength(1);
    const h = drafts[0].holdings;
    expect(h.map((x) => x.symbol)).toEqual(["ZEBRAINFRA", "MANGOFOODS"]); // 0-value scrip + totals row dropped
    expect(h[0].units).toBe(100);
    expect(h[0].marketValue).toBe(25000);
  });

  it("stays INR and classifies demat rows (ticker + units) as indian_equity", () => {
    expect(drafts[0].account.currency).toBe("INR");
    expect(drafts[0].holdings.every((x) => x.assetClass === "indian_equity")).toBe(true);
  });
});

// A Fidelity "Portfolio Positions" export with several accounts in ONE file, segregated by the
// Account Name column (not stacked sections), plus a money-market sweep and an all-"--" row.
const FIDELITY_MULTI = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Type
111,Brokerage,AAPL,APPLE INC,100,$220.00,"$22,000.00","$15,000.00",Cash
111,Brokerage,SPAXX**,HELD IN MONEY MARKET,,,"$0.01",,Cash
222,Roth IRA,VTI,VANGUARD TOTAL STOCK MARKET ETF,50,$280.00,"$14,000.00","$9,000.00",Cash
333,Empty IRA,GHOST,PLACEHOLDER SECURITY,0.5,--,--,--,Cash
"Brokerage services are provided by Sample Brokerage LLC, Member NYSE, SIPC."`;

describe("parseCsv (Fidelity multi-account, segregated by Account Name column)", () => {
  const drafts = parseCsv(FIDELITY_MULTI, "Portfolio_Positions.csv");

  it("splits into one account per Account Name, dropping the all-'--' account", () => {
    expect(drafts.map((d) => d.account.name).sort()).toEqual(["Brokerage", "Roth IRA"]);
  });

  it("keeps each account's own holdings and reads the money-market sweep as cash", () => {
    const brok = drafts.find((d) => d.account.name === "Brokerage")!;
    expect(brok.holdings.map((h) => h.symbol)).toEqual(["AAPL", "SPAXX**"]); // ** = Fidelity footnote
    expect(brok.holdings.find((h) => h.symbol === "SPAXX**")!.assetClass).toBe("cash");
    expect(brok.account.currency).toBe("USD");
  });
});

describe("parseCsv (unrecognizable layout → nothing parses, so the UI can offer Claude)", () => {
  it("returns no holdings when no value/name columns are found", () => {
    const junk = `Foo,Bar,Baz\nhello,world,123\nlorem,ipsum,456`;
    const drafts = parseCsv(junk, "weird.csv");
    expect(drafts.reduce((n, d) => n + d.holdings.length, 0)).toBe(0);
  });
});
