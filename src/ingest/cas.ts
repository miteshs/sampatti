// CAMS / KFintech Consolidated Account Statement (CAS) → ImportDrafts, parsed ENTIRELY on
// this device (a CAS is the single most sensitive statement a user has — their complete
// mutual-fund life with PAN and folio numbers — so it must never touch the AI path).
//
// The mailback CAS is a text-layer PDF. After pdf.ts reconstructs visual lines, the
// detailed variant reads, per scheme:
//
//   Hypothetic Mutual Fund
//   Folio No: 91099 / 0  PAN: XXXXX1234X  KYC: OK
//   INF0AA0TEST1-Hypothetic Flexi Cap Fund - Direct Growth - ISIN: INF0AA0TEST1 (Advisor: DIRECT) Registrar : CAMS
//   Opening Unit Balance: 1,000.000
//   …transactions…
//   Closing Unit Balance: 1,234.567 NAV on 31-May-2026: INR 95.5000 Total Cost Value: INR 1,00,000.00 Market Value on 31-May-2026: INR 1,17,901.15
//
// The summary-only variant has just a PORTFOLIO SUMMARY table (fund house → cost/market) —
// we fall back to fund-house-level holdings with a warning. Conservative throughout: a
// scheme only imports when units AND a value/NAV are found; zero-balance schemes skip.

import type { AssetClass } from "../domain/types";
import type { ImportDraft } from "../domain/types";

const ISIN = /\bIN[A-Z0-9]{10}\b/; // Indian MF ISINs (INF…); demat CAS equities use INE…
const num = (s: string): number => parseFloat(s.replace(/,/g, ""));

// Does this extracted text look like a CAMS/KFintech CAS at all?
export function looksLikeCas(lines: string[]): boolean {
  const head = lines.slice(0, 60).join(" ").toLowerCase();
  const hasTitle = /consolidated account statement/.test(head);
  const body = lines.join(" ");
  const hasMfStructure = /Folio No/i.test(body) && (/Closing Unit Balance/i.test(body) || /PORTFOLIO SUMMARY/i.test(body));
  return hasTitle && hasMfStructure;
}

// MF scheme name → our asset class. MF-specific and deliberately simple: tax-saver funds
// are ELSS, anything debt-shaped is debt_mf, index/ETF named funds are index_etf, the rest
// of a CAS is equity_mf (it's a mutual-fund statement by definition).
export function mfClassFromName(name: string): AssetClass {
  const n = name.toLowerCase();
  if (/elss|tax saver|tax saving|long term equity/.test(n)) return "elss";
  if (/liquid|overnight|money market|ultra short|low duration|short duration|short term|corporate bond|banking & psu|banking and psu|credit risk|gilt|g-sec|dynamic bond|income fund|floater|floating rate|savings fund|arbitrage|debt/.test(n)) return "debt_mf";
  if (/index|nifty|sensex|\betf\b/.test(n)) return "index_etf";
  if (/gold/.test(n)) return "gold_other";
  return "equity_mf";
}

interface Scheme {
  isin?: string;
  name: string;
  folio?: string;
  units?: number;
  nav?: number;
  cost?: number;
  market?: number;
}

// Strip the decorations CAS appends to scheme names.
function cleanSchemeName(raw: string): string {
  return raw
    .replace(/^\s*IN[A-Z0-9]{10}\s*-\s*/, "") // leading "INF…-"
    .replace(/-?\s*ISIN\s*:?\s*IN[A-Z0-9]{10}/i, "")
    .replace(/\(\s*Advisor\s*:[^)]*\)/i, "")
    .replace(/Registrar\s*:?\s*[A-Za-z]+/i, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCamsCas(lines: string[], source: string): ImportDraft[] {
  const all = lines.map((l) => l.trim()).filter(Boolean);

  // Statement valuation date → account asOf: prefer "Market Value on DD-MMM-YYYY",
  // else the period's "To DD-MMM-YYYY".
  const dateOf = (re: RegExp): string | undefined => {
    for (const l of all) {
      const m = l.match(re);
      if (m) {
        const d = new Date(m[1].replace(/-/g, " "));
        if (!Number.isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      }
    }
    return undefined;
  };
  const asOf =
    dateOf(/Market Value on (\d{2}-\w{3}-\d{4})/i) ?? dateOf(/\bTo\s+(\d{2}-\w{3}-\d{4})/);

  // ---- detailed variant: walk scheme blocks --------------------------------
  const schemes: Scheme[] = [];
  let cur: Scheme | null = null;
  let curFolio: string | undefined;
  let skippedZero = 0;

  const closeScheme = () => {
    if (!cur) return;
    if (cur.units != null && cur.units > 0.005 && (cur.market != null || cur.nav != null)) {
      schemes.push(cur);
    } else if (cur.units != null && cur.units <= 0.005) {
      skippedZero++;
    }
    cur = null;
  };

  for (const line of all) {
    const folioM = line.match(/Folio No\s*:?\s*([0-9][0-9 /-]*)/i);
    if (folioM) curFolio = folioM[1].trim().replace(/\s+/g, " ");

    // A scheme starts on a line carrying an ISIN (either leading "INF…-Name" or "ISIN: INF…").
    if (ISIN.test(line) && !/^ISIN\b/i.test(line.trim()) && /[A-Za-z]{4}/.test(line.replace(ISIN, ""))) {
      closeScheme();
      cur = {
        isin: line.match(ISIN)?.[0],
        name: cleanSchemeName(line),
        folio: curFolio,
      };
      continue;
    }
    if (!cur) continue;

    const units = line.match(/Closing Unit Balance\s*:?\s*([\d,]+\.?\d*)/i);
    if (units) cur.units = num(units[1]);
    const nav = line.match(/NAV on \d{2}-\w{3}-\d{4}\s*:?\s*(?:INR\s*)?([\d,]+\.?\d*)/i);
    if (nav) cur.nav = num(nav[1]);
    const cost = line.match(/(?:Total\s+)?Cost Value\s*:?\s*(?:INR\s*)?([\d,]+\.?\d*)/i);
    if (cost) cur.cost = num(cost[1]);
    const market = line.match(/Market Value on \d{2}-\w{3}-\d{4}\s*:?\s*(?:INR\s*)?([\d,]+\.?\d*)/i);
    if (market) cur.market = num(market[1]);
  }
  closeScheme();

  const warnings: string[] = [];
  if (skippedZero > 0) warnings.push(`${skippedZero} zero-balance scheme${skippedZero === 1 ? "" : "s"} skipped.`);

  if (schemes.length > 0) {
    const holdings: ImportDraft["holdings"] = schemes.map((s) => ({
      symbol: s.isin,
      name: s.name || "Mutual fund scheme",
      assetClass: mfClassFromName(s.name),
      units: s.units,
      marketValue: Math.round((s.market ?? s.units! * s.nav!) * 100) / 100,
      costBasis: s.cost,
      currency: "INR",
    }));
    const missingCost = holdings.filter((h) => h.costBasis == null).length;
    if (missingCost > 0) warnings.push(`${missingCost} scheme${missingCost === 1 ? "" : "s"} had no cost value on the statement.`);
    return [{
      account: {
        name: "Mutual Funds — CAS",
        institution: "CAMS / KFintech",
        accountType: "mutual_fund",
        taxTreatment: "taxable",
        region: "India",
        currency: "INR",
        asOf,
      },
      holdings,
      warnings,
      source,
    }];
  }

  // ---- summary-only fallback: PORTFOLIO SUMMARY rows (fund house → cost/market) ----
  const start = all.findIndex((l) => /PORTFOLIO SUMMARY/i.test(l));
  if (start >= 0) {
    const holdings: ImportDraft["holdings"] = [];
    for (const line of all.slice(start + 1, start + 80)) {
      if (/^Total\b/i.test(line)) break;
      const m = line.match(/^(.{4,}?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/);
      if (m && /fund/i.test(m[1])) {
        holdings.push({
          name: `${m[1].trim()} (all schemes)`,
          assetClass: "equity_mf",
          marketValue: num(m[3]),
          costBasis: num(m[2]),
          currency: "INR",
        });
      }
    }
    if (holdings.length > 0) {
      return [{
        account: {
          name: "Mutual Funds — CAS",
          institution: "CAMS / KFintech",
          accountType: "mutual_fund",
          taxTreatment: "taxable",
          region: "India",
          currency: "INR",
          asOf,
        },
        holdings,
        warnings: [
          "Summary-only CAS: imported at fund-house level. Request the DETAILED CAS on camsonline.com for scheme-level holdings.",
          ...warnings,
        ],
        source,
      }];
    }
  }

  throw new Error(
    "This looks like a CAS but no holdings could be read from it. If it's a summary CAS, request the detailed one on camsonline.com.",
  );
}
