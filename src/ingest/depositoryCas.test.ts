// NSDL/CDSL depository CAS: per-DP demat accounts, ISIN-anchored rows validated by
// qty × price ≈ value (subtotals can't sneak in), instrument-class detection (incl. AIF +
// MLD), per-account/per-folio HOLDER names with joint detection, AIF units split into a
// managed account, and joint MF folios kept out of the sole-held pile. Synthetic fixture:
// 22 listed entries (6 demat + 2 AIF schemes + 14 MF folios), 5 of them joint and all
// sharing first holder "ARJUN MEHTA". No real PANs/holdings — fully fabricated.
import { describe, expect, it } from "vitest";
import { dematClassFromName, holdersFromLine, looksLikeDepositoryCas, parseDepositoryCas, rowTriple } from "./depositoryCas";
import { isJoint } from "../domain/types";
import { looksLikeCas } from "./cas";
import FIXTURE from "./__fixtures__/nsdlCasComplex.json";

const drafts = parseDepositoryCas(FIXTURE, "nsdl-cas-complex.pdf");
const byInstitution = (s: string) => drafts.find((d) => d.account.institution.includes(s))!;
const byName = (s: string) => drafts.find((d) => d.account.name.includes(s))!;

describe("looksLikeDepositoryCas / routing", () => {
  it("detects the depository CAS and is mutually exclusive with the CAMS detector", () => {
    expect(looksLikeDepositoryCas(FIXTURE)).toBe(true);
    expect(looksLikeCas(FIXTURE)).toBe(false); // Folio No present but no Closing Unit Balance / PORTFOLIO SUMMARY
  });

  it("rejects ordinary statements and the CAMS MF CAS", () => {
    expect(looksLikeDepositoryCas(["Bank statement", "UPI 500.00"])).toBe(false);
    expect(looksLikeDepositoryCas([
      "Consolidated Account Statement", "Folio No: 1 / 0", "Closing Unit Balance: 5 NAV on 31-May-2026: INR 10",
    ])).toBe(false);
  });
});

describe("rowTriple", () => {
  it("finds the consistent qty×price≈value triple and rejects subtotal tails", () => {
    expect(rowTriple([10, 200, 2850, 570000])).toMatchObject({ units: 200, price: 2850 });
    expect(rowTriple([765000])).toBeNull(); // a lone subtotal value
    expect(rowTriple([3, 7, 1000])).toBeNull(); // nothing multiplies to the value
  });
});

describe("holdersFromLine", () => {
  it("reads positional and combined holder forms; ignores non-holder lines", () => {
    expect(holdersFromLine("First / Sole Holder : ARJUN MEHTA")).toEqual(["ARJUN MEHTA"]);
    expect(holdersFromLine("Second Holder : PRIYA MEHTA")).toEqual(["PRIYA MEHTA"]);
    expect(holdersFromLine("Holder(s): ARJUN MEHTA, PRIYA MEHTA")).toEqual(["ARJUN MEHTA", "PRIYA MEHTA"]);
    expect(holdersFromLine("Client ID 22223333 Status: Active")).toBeNull();
    expect(holdersFromLine("DP Name: HDFC SECURITIES LIMITED")).toBeNull();
  });
});

describe("parseDepositoryCas — structure", () => {
  it("produces one draft per demat account, a managed AIF account, the canonical MF account, and split joint MF accounts", () => {
    // 6 demat + 1 AIF + 1 canonical MF + 2 joint MF = 10
    expect(drafts).toHaveLength(10);
    expect(byInstitution("ZERODHA").account.accountType).toBe("demat");
    expect(byName("Alternative Investment Funds").account.accountType).toBe("pms_aif");
    expect(byName("Mutual Funds — CAS").account.institution).toBe("CAMS / KFintech");
  });

  it("every draft carries the statement date as asOf", () => {
    for (const d of drafts) expect(d.account.asOf).toBe("2026-05-31");
  });
});

describe("parseDepositoryCas — holders & joint", () => {
  it("captures holder name(s) on each account", () => {
    expect(byInstitution("ZERODHA").account.holders).toEqual(["ARJUN MEHTA"]);
    expect(byInstitution("HDFC").account.holders).toEqual(["ARJUN MEHTA", "PRIYA MEHTA"]);
    expect(byInstitution("KOTAK").account.holders).toEqual(["ARJUN MEHTA", "RAVI MEHTA"]);
    expect(byInstitution("ZIPPY").account.holders).toEqual(["ARJUN MEHTA", "MEERA MEHTA"]);
  });

  it("flags exactly the 5 joint accounts, all with the same first holder", () => {
    const joint = drafts.filter((d) => isJoint(d.account.holders));
    expect(joint).toHaveLength(5);
    for (const d of joint) expect(d.account.holders![0]).toBe("ARJUN MEHTA");
    // sole accounts are not joint
    expect(isJoint(byInstitution("ZERODHA").account.holders)).toBe(false);
    expect(isJoint(byName("Alternative Investment Funds").account.holders)).toBe(false);
  });

  it("keeps sole-held folios in one canonical MF account; joint folios split out by holder-set", () => {
    const canonical = drafts.find((d) => d.account.name === "Mutual Funds — CAS")!;
    expect(canonical.account.holders).toEqual(["ARJUN MEHTA"]);
    expect(canonical.holdings).toHaveLength(12);
    const jointMf = drafts.filter((d) => /Joint/.test(d.account.name));
    expect(jointMf).toHaveLength(2);
    expect(jointMf.map((d) => d.account.name).some((n) => n.includes("PRIYA"))).toBe(true);
  });
});

describe("parseDepositoryCas — holdings & classes", () => {
  it("reads equities with price-validated values and ISINs; skips subtotals", () => {
    const zerodha = byInstitution("ZERODHA");
    expect(zerodha.holdings).toHaveLength(2); // RELIANT + TCS; "Sub Total" skipped
    const rel = zerodha.holdings.find((h) => /RELIANT/.test(h.name))!;
    expect(rel.symbol).toBe("INE002A01018");
    expect(rel.units).toBe(200);
    expect(rel.marketValue).toBeCloseTo(570000);
  });

  it("classifies the full asset variety", () => {
    const cls = (sym: string) => drafts.flatMap((d) => d.holdings).find((h) => h.symbol === sym)!.assetClass;
    expect(cls("INE0NB01R015")).toBe("index_etf"); // NIFTYBEES ETF
    expect(cls("INE0EMB01010")).toBe("reit_invit"); // Embassy REIT
    expect(cls("INE0PWG01017")).toBe("reit_invit"); // Powergrid InvIT
    expect(cls("INE0SGB02027")).toBe("gold_sgb"); // SGB (before the % NCD rule)
    expect(cls("INE0NCD01019")).toBe("fd_rd"); // NHAI NCD
    expect(cls("INE0MLD01018")).toBe("structured_notes"); // market-linked debenture
    expect(cls("INF0ELS01019")).toBe("elss"); // ELSS tax saver
    expect(cls("INF0LIQ01017")).toBe("debt_mf"); // liquid fund
    expect(cls("INF0GLD01013")).toBe("gold_other"); // gold FoF
  });

  it("routes AIF units into the managed account as pms", () => {
    const aif = byName("Alternative Investment Funds");
    expect(aif.holdings).toHaveLength(2);
    expect(aif.holdings.every((h) => h.assetClass === "pms")).toBe(true);
    expect(aif.holdings.find((h) => h.symbol === "INF0AIF01015")!.marketValue).toBeCloseTo(1250000);
  });

  it("MF folio rows carry units and value, no cost", () => {
    const blu = drafts.flatMap((d) => d.holdings).find((h) => h.symbol === "INF0BLU01011")!;
    expect(blu.units).toBeCloseTo(1000);
    expect(blu.marketValue).toBeCloseTo(145300);
    expect(blu.costBasis).toBeUndefined();
  });
});

describe("dematClassFromName", () => {
  it("maps demat instrument names incl. AIF and MLD", () => {
    expect(dematClassFromName("EVERGREEN ALTERNATIVE INVESTMENT FUND CATEGORY II")).toBe("pms");
    expect(dematClassFromName("HIGHPEAK AIF CATEGORY III")).toBe("pms");
    expect(dematClassFromName("BARCLAYS MARKET LINKED DEBENTURE MLD")).toBe("structured_notes");
    expect(dematClassFromName("SOME GOLD ETF")).toBe("gold_other");
    expect(dematClassFromName("POWERGRID INVIT FUND")).toBe("reit_invit");
    expect(dematClassFromName("NHAI 7.35% NCD TRANCHE II")).toBe("fd_rd");
    expect(dematClassFromName("PLAIN COMPANY LIMITED")).toBe("indian_equity");
  });
});
