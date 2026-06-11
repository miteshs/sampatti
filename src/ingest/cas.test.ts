// CAS parsing is the most consequential importer in the app (a user's entire MF life in one
// file) — these tests pin the detailed-variant state machine, the lakh/crore number forms,
// class detection, the summary fallback, and that non-CAS documents are left alone.
// The fixture is SYNTHETIC: fake AMCs, fake folios, fake ISIN-shaped codes.
import { describe, expect, it } from "vitest";
import { looksLikeCas, mfClassFromName, parseCamsCas } from "./cas";

const DETAILED: string[] = [
  "Consolidated Account Statement",
  "01-Jan-2025 To 31-May-2026",
  "Email Id: someone@example.test",
  "PORTFOLIO SUMMARY",
  "Mutual Fund Cost Value Market Value",
  "Axbank Mutual Fund 3,50,000.00 5,12,345.67",
  "Hypothetic Mutual Fund 12,00,000.00 21,45,000.11",
  "Total 15,50,000.00 26,57,345.78",
  "Axbank Mutual Fund",
  "Folio No: 91012345 / 0 KYC: OK",
  "INF0AX0TEST1-Axbank ELSS Tax Saver Fund - Direct Growth - ISIN: INF0AX0TEST1(Advisor: DIRECT) Registrar : CAMS",
  "Opening Unit Balance: 1,000.000",
  "01-Feb-2025 Purchase 50,000.00 405.010 123.456 1,405.010",
  "Closing Unit Balance: 1,405.010 NAV on 31-May-2026: INR 95.5000 Total Cost Value: INR 1,50,000.00 Market Value on 31-May-2026: INR 1,34,178.46",
  "INF0AX0TEST2-Axbank Liquid Fund - Direct Growth - ISIN: INF0AX0TEST2(Advisor: DIRECT) Registrar : CAMS",
  "Opening Unit Balance: 0.000",
  "Closing Unit Balance: 720.500 NAV on 31-May-2026: INR 277.5800 Total Cost Value: INR 2,00,000.00 Market Value on 31-May-2026: INR 2,00,021.39",
  "Hypothetic Mutual Fund",
  "Folio No: 7700112233 / 9 KYC: OK",
  "INF0HY0TEST3-Hypothetic Flexi Cap Fund - Regular Growth - ISIN: INF0HY0TEST3(Advisor: ARN-0000) Registrar : KFINTECH",
  "Opening Unit Balance: 9,876.543",
  "Closing Unit Balance: 9,876.543 NAV on 31-May-2026: INR 108.3100 Total Cost Value: INR 12,00,000.00 Market Value on 31-May-2026: INR 10,69,728.37",
  "INF0HY0TEST4-Hypothetic Overnight Fund - Direct Growth - ISIN: INF0HY0TEST4 Registrar : KFINTECH",
  "Opening Unit Balance: 55.000",
  "11-Mar-2026 Redemption -55.000",
  "Closing Unit Balance: 0.000 NAV on 31-May-2026: INR 1,310.0000 Total Cost Value: INR 0.00 Market Value on 31-May-2026: INR 0.00",
];

describe("looksLikeCas", () => {
  it("recognizes a CAS and rejects ordinary statements", () => {
    expect(looksLikeCas(DETAILED)).toBe(true);
    expect(looksLikeCas(["HDFC Bank Statement", "Date Narration Amount", "01-01-2026 UPI-PAYMENT 500.00"])).toBe(false);
    expect(looksLikeCas(["Consolidated Account Statement"])).toBe(false); // title alone isn't enough
  });
});

describe("parseCamsCas — detailed variant", () => {
  const [draft] = parseCamsCas(DETAILED, "cas.pdf");

  it("one CAS account, holdings per live scheme, zero-balance schemes skipped", () => {
    expect(draft.account.name).toBe("Mutual Funds — CAS");
    expect(draft.account.institution).toBe("CAMS / KFintech");
    expect(draft.holdings).toHaveLength(3); // overnight fund redeemed to zero → skipped
    expect(draft.warnings.join(" ")).toMatch(/zero-balance/);
  });

  it("captures units, market value, REAL cost, ISIN and folio", () => {
    const elss = draft.holdings.find((h) => /ELSS/i.test(h.name))!;
    expect(elss.symbol).toBe("INF0AX0TEST1");
    expect(elss.units).toBeCloseTo(1405.01);
    expect(elss.marketValue).toBeCloseTo(134178.46);
    expect(elss.costBasis).toBeCloseTo(150000);
    const flexi = draft.holdings.find((h) => /Flexi Cap/.test(h.name))!;
    expect(flexi.marketValue).toBeCloseTo(1069728.37); // lakh-grouped number read correctly
  });

  it("classifies schemes from their names", () => {
    expect(draft.holdings.find((h) => /ELSS/i.test(h.name))!.assetClass).toBe("elss");
    expect(draft.holdings.find((h) => /Liquid/.test(h.name))!.assetClass).toBe("debt_mf");
    expect(draft.holdings.find((h) => /Flexi/.test(h.name))!.assetClass).toBe("equity_mf");
  });

  it("scheme names are cleaned of ISIN/advisor/registrar noise", () => {
    for (const h of draft.holdings) {
      expect(h.name).not.toMatch(/ISIN|Advisor|Registrar|INF0/);
    }
  });

  it("statement valuation date becomes the account asOf", () => {
    expect(draft.account.asOf).toBe("2026-05-31");
  });
});

describe("parseCamsCas — summary-only fallback", () => {
  const SUMMARY = [
    "Consolidated Account Statement",
    "01-Jan-2026 To 31-May-2026",
    "Folio No: 123 / 0",
    "PORTFOLIO SUMMARY",
    "Mutual Fund Cost Value Market Value",
    "Axbank Mutual Fund 3,50,000.00 5,12,345.67",
    "Hypothetic Mutual Fund 12,00,000.00 21,45,000.11",
    "Total 15,50,000.00 26,57,345.78",
  ];

  it("imports at fund-house level with an explicit warning", () => {
    const [draft] = parseCamsCas(SUMMARY, "cas-summary.pdf");
    expect(draft.holdings).toHaveLength(2);
    expect(draft.holdings[0].name).toMatch(/Axbank.*all schemes/);
    expect(draft.holdings[0].costBasis).toBeCloseTo(350000);
    expect(draft.holdings[1].marketValue).toBeCloseTo(2145000.11);
    expect(draft.warnings.join(" ")).toMatch(/Summary-only/);
  });

  it("a CAS-looking document with no readable holdings throws a helpful error", () => {
    expect(() => parseCamsCas(["Consolidated Account Statement", "Folio No: 1", "nothing else"], "x.pdf"))
      .toThrow(/no holdings could be read/);
  });
});

describe("mfClassFromName", () => {
  it("maps the MF universe sensibly", () => {
    expect(mfClassFromName("Foo Long Term Equity Fund")).toBe("elss");
    expect(mfClassFromName("Bar Banking & PSU Debt Fund")).toBe("debt_mf");
    expect(mfClassFromName("Baz Nifty 50 Index Fund")).toBe("index_etf");
    expect(mfClassFromName("Qux Gold Fund FoF")).toBe("gold_other");
    expect(mfClassFromName("Quux Midcap Opportunities Fund")).toBe("equity_mf");
  });
});
