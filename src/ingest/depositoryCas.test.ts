// NSDL/CDSL depository CAS: per-DP demat accounts, ISIN-anchored rows validated by
// qty × price ≈ value (subtotals can't sneak in), instrument-class detection, and the MF
// folio section landing in the same canonical account as the CAMS CAS. Synthetic fixture.
import { describe, expect, it } from "vitest";
import { dematClassFromName, looksLikeDepositoryCas, parseDepositoryCas, rowTriple } from "./depositoryCas";
import { looksLikeCas } from "./cas";

const FIXTURE: string[] = [
  "Consolidated Account Statement",
  "Statement for the period from 01-May-2026 to 31-May-2026",
  "ACCOUNT(S) HELD WITH NSDL",
  "DP Name: ZIPPY BROKING LIMITED DP ID IN300999",
  "Client ID 10001111 Status: Active",
  "Equities (E)",
  "ISIN Security Face Value Current Bal Market Price Value",
  "INE0AA0TEST1 RELIANT INDUSTRIES LIMITED 10.00 250 2,856.50 7,14,125.00",
  "INE0BB0TEST2 NIFTYBEES EXCHANGE TRADED FUND 1.00 1,000 285.25 2,85,250.00",
  "INE0CC0TEST3 EMBASSY OFFICE REIT UNITS 10.00 500 412.00 2,06,000.00",
  "Sub Total 12,05,375.00",
  "Government Securities (G)",
  "INE0DD0TEST4 SOVEREIGN GOLD BOND 2.75% AUG 2027 SGB 1.00 40 9,150.00 3,66,000.00",
  "ACCOUNT(S) HELD WITH CDSL",
  "DP Name: ORBIT SECURITIES PVT LTD",
  "BO ID 1201234500001111",
  "INE0EE0TEST5 TATAN MOTORS LIMITED 2.00 100 1,011.55 1,01,155.00",
  "MUTUAL FUND FOLIOS (F)",
  "INF0HY0TEST3 Hypothetic Flexi Cap Fund - Regular Growth Folio No: 7700112233/9 9,876.543 108.31 10,69,728.37",
  "Grand Total 28,42,258.37",
];

describe("looksLikeDepositoryCas / routing", () => {
  it("detects the depository CAS and is mutually exclusive with the CAMS detector", () => {
    expect(looksLikeDepositoryCas(FIXTURE)).toBe(true);
    expect(looksLikeCas(FIXTURE)).toBe(false); // no CAMS-style markers
  });

  it("rejects ordinary statements and the CAMS MF CAS", () => {
    expect(looksLikeDepositoryCas(["Bank statement", "UPI 500.00"])).toBe(false);
    expect(looksLikeDepositoryCas([
      "Consolidated Account Statement", "Folio No: 1 / 0", "Closing Unit Balance: 5 NAV on 31-May-2026: INR 10",
    ])).toBe(false); // CAMS CAS has no DP/Client IDs or INE rows
  });
});

describe("rowTriple", () => {
  it("finds the consistent qty×price≈value triple and rejects subtotal tails", () => {
    expect(rowTriple([10, 250, 2856.5, 714125])).toMatchObject({ units: 250, price: 2856.5 });
    expect(rowTriple([1205375])).toBeNull(); // a lone subtotal value
    expect(rowTriple([3, 7, 1000])).toBeNull(); // nothing multiplies to the value
  });
});

describe("parseDepositoryCas", () => {
  const drafts = parseDepositoryCas(FIXTURE, "nsdl-cas.pdf");

  it("one draft per demat account (by DP) + one canonical MF account", () => {
    expect(drafts).toHaveLength(3);
    const [zippy, orbit, mf] = drafts;
    expect(zippy.account.institution).toBe("ZIPPY BROKING LIMITED");
    expect(zippy.account.accountType).toBe("demat");
    expect(orbit.account.institution).toBe("ORBIT SECURITIES PVT LTD");
    expect(mf.account.name).toBe("Mutual Funds — CAS"); // same identity as the CAMS parser
    expect(mf.account.institution).toBe("CAMS / KFintech");
  });

  it("reads equities with units, price-validated values, and ISINs; skips subtotals", () => {
    const zippy = drafts[0];
    expect(zippy.holdings).toHaveLength(4); // 3 equities + SGB; "Sub Total" skipped
    const rel = zippy.holdings.find((h) => /RELIANT/.test(h.name))!;
    expect(rel.symbol).toBe("INE0AA0TEST1");
    expect(rel.units).toBe(250);
    expect(rel.marketValue).toBeCloseTo(714125);
  });

  it("classifies ETFs, REITs, SGBs and plain stocks", () => {
    const classes = Object.fromEntries(drafts[0].holdings.map((h) => [h.symbol, h.assetClass]));
    expect(classes["INE0AA0TEST1"]).toBe("indian_equity");
    expect(classes["INE0BB0TEST2"]).toBe("index_etf");
    expect(classes["INE0CC0TEST3"]).toBe("reit_invit");
    expect(classes["INE0DD0TEST4"]).toBe("gold_sgb");
    expect(drafts[1].holdings[0].assetClass).toBe("indian_equity");
  });

  it("MF folio rows carry units and value, with the no-cost warning", () => {
    const mf = drafts[2];
    expect(mf.holdings[0].symbol).toBe("INF0HY0TEST3");
    expect(mf.holdings[0].units).toBeCloseTo(9876.543);
    expect(mf.holdings[0].marketValue).toBeCloseTo(1069728.37);
    expect(mf.holdings[0].costBasis).toBeUndefined();
    expect(mf.warnings.join(" ")).toMatch(/without cost/);
  });

  it("statement date becomes asOf on every draft", () => {
    for (const d of drafts) expect(d.account.asOf).toBe("2026-05-31");
  });
});

describe("dematClassFromName", () => {
  it("maps demat instrument names", () => {
    expect(dematClassFromName("SOME GOLD ETF")).toBe("gold_other");
    expect(dematClassFromName("POWERGRID INVIT FUND")).toBe("reit_invit");
    expect(dematClassFromName("NHAI 7.35% NCD TRANCHE II")).toBe("fd_rd");
    expect(dematClassFromName("PLAIN COMPANY LIMITED")).toBe("indian_equity");
  });
});
