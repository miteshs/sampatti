// NSDL / CDSL depository CAS → ImportDrafts, parsed ENTIRELY on this device (like the
// CAMS CAS in cas.ts — this is the other half of the India activation story: the monthly
// e-CAS lists EVERY demat holding across both depositories plus MF folios).
//
// Layout reality: the depositories vary the tables month to month, so this parser anchors
// on what never changes — ISINs. An equity row carries an INE… ISIN and a numeric tail in
// which SOME (quantity, price, value) triple must satisfy qty × price ≈ value; rows that
// can't produce a consistent triple (subtotals, headers) are skipped. Demat accounts become
// separate draft accounts (one per DP); the MF folio section lands in the SAME canonical
// "Mutual Funds — CAS" account the CAMS parser uses, so importing both kinds of CAS
// converges on one MF account via the normal update-match instead of duplicating.

import type { AssetClass, ImportDraft } from "../domain/types";
import { mfClassFromName } from "./cas";

const INE = /\bINE[A-Z0-9]{9}\b/; // demat instruments
const INF = /\bINF[A-Z0-9]{9}\b/; // MF folios (statement-of-account form)
const NUM = /[\d,]+\.?\d*/g;
const num = (s: string): number => parseFloat(s.replace(/,/g, ""));

export function looksLikeDepositoryCas(lines: string[]): boolean {
  const text = lines.join(" ");
  const depository =
    /National Securities Depository|NSDL|Central Depository Services|CDSL/i.test(text) &&
    /\bDP\s*(ID|Name)|Client ID|BO ID/i.test(text);
  return depository && INE.test(text);
}

// Instrument class from a demat security's name. Conservative; plain INE rows are stocks.
export function dematClassFromName(name: string): AssetClass {
  const n = name.toLowerCase();
  if (/\betf\b|exchange traded/.test(n)) return /gold/.test(n) ? "gold_other" : "index_etf";
  if (/\breit\b|\binvit\b|business trust/.test(n)) return "reit_invit";
  if (/sovereign gold|\bsgb\b|gold bond/.test(n)) return "gold_sgb";
  if (/\bncd\b|debenture|\bbond\b|\d(\.\d+)?\s*%/.test(n)) return "fd_rd";
  return "indian_equity";
}

// From a row's numeric tail, find the (qty, price, value) triple: value is the LAST number,
// and some earlier pair must satisfy qty × price ≈ value. Returns null when nothing fits —
// which is exactly what subtotal/summary lines do.
export function rowTriple(tail: number[]): { units: number; price: number; value: number } | null {
  if (tail.length < 2) return null;
  const value = tail[tail.length - 1];
  if (!(value > 0)) return null;
  for (let p = tail.length - 2; p >= 0; p--) {
    for (let q = tail.length - 2; q >= 0; q--) {
      if (q === p) continue;
      const qty = tail[q], price = tail[p];
      if (!(qty > 0) || !(price > 0)) continue;
      if (Math.abs(qty * price - value) <= Math.max(1, value * 0.02)) {
        return { units: qty, price, value };
      }
    }
  }
  return null;
}

interface DematAccount {
  label: string;
  depository: "NSDL" | "CDSL";
  holdings: ImportDraft["holdings"];
}

export function parseDepositoryCas(lines: string[], source: string): ImportDraft[] {
  const all = lines.map((l) => l.trim()).filter(Boolean);

  const asOf = (() => {
    for (const l of all) {
      const m = l.match(/as on (\d{2}-\w{3}-\d{4})/i) ?? l.match(/\bto\s+(\d{2}-\w{3}-\d{4})/i);
      if (m) {
        const d = new Date(m[1].replace(/-/g, " "));
        if (!Number.isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      }
    }
    return undefined;
  })();

  const accounts: DematAccount[] = [];
  let depo: "NSDL" | "CDSL" = "NSDL";
  let cur: DematAccount | null = null;
  const mfHoldings: ImportDraft["holdings"] = [];

  const ensureAccount = (): DematAccount => {
    if (!cur) {
      cur = { label: `Demat (${depo})`, depository: depo, holdings: [] };
      accounts.push(cur);
    }
    return cur;
  };

  for (const line of all) {
    // Section context: which depository's accounts are we in?
    if (/HELD WITH NSDL|NSDL Demat Account/i.test(line)) { depo = "NSDL"; cur = null; continue; }
    if (/HELD WITH CDSL|CDSL Demat Account/i.test(line)) { depo = "CDSL"; cur = null; continue; }

    // A new demat account header (DP name / IDs) starts a new draft account.
    const dp = line.match(/DP Name\s*:?\s*(.+?)(?:\s*DP ID|$)/i);
    if (dp && dp[1].trim().length > 2) {
      cur = { label: dp[1].trim().replace(/\s+/g, " "), depository: depo, holdings: [] };
      accounts.push(cur);
      continue;
    }
    if (/\bDP ID\b|\bClient ID\b|\bBO ID\b/i.test(line) && !INE.test(line)) {
      ensureAccount();
      continue;
    }

    // MF folio rows (statement-of-account form) — INF ISINs.
    const inf = line.match(INF);
    if (inf) {
      const tail = (line.match(NUM) ?? []).map(num).filter((n) => Number.isFinite(n));
      const triple = rowTriple(tail.slice(-6));
      if (triple) {
        const name = line
          .replace(INF, "")
          .replace(/Folio\s*(No\.?)?\s*:?\s*[\w/ -]*/i, "")
          .replace(NUM, "")
          .replace(/[|·]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (name.length > 3) {
          mfHoldings.push({
            symbol: inf[0],
            name,
            assetClass: mfClassFromName(name),
            units: triple.units,
            marketValue: Math.round(triple.value * 100) / 100,
            currency: "INR",
          });
        }
      }
      continue;
    }

    // Demat instrument rows — INE ISINs with a consistent qty×price≈value tail.
    const ine = line.match(INE);
    if (ine) {
      const tail = (line.match(NUM) ?? []).map(num).filter((n) => Number.isFinite(n));
      const triple = rowTriple(tail.slice(-6));
      if (!triple) continue; // subtotal / unparseable row
      const name = line.replace(INE, "").replace(NUM, "").replace(/\s+/g, " ").trim();
      if (name.length < 3) continue;
      ensureAccount().holdings.push({
        symbol: ine[0],
        name,
        assetClass: dematClassFromName(name),
        units: triple.units,
        marketValue: Math.round(triple.value * 100) / 100,
        currency: "INR",
      });
    }
  }

  const drafts: ImportDraft[] = [];
  for (const a of accounts.filter((x) => x.holdings.length > 0)) {
    drafts.push({
      account: {
        name: `${a.label} Demat`.replace(/Demat \((NSDL|CDSL)\) Demat/, "Demat ($1)"),
        institution: a.label,
        accountType: "demat",
        taxTreatment: "taxable",
        region: "India",
        currency: "INR",
        asOf,
      },
      holdings: a.holdings,
      warnings: [`From the ${a.depository} consolidated statement — prices as of the statement date.`],
      source,
    });
  }
  if (mfHoldings.length > 0) {
    drafts.push({
      account: {
        // Same canonical identity as the CAMS CAS account, so the two CAS sources
        // update one MF account instead of duplicating each other.
        name: "Mutual Funds — CAS",
        institution: "CAMS / KFintech",
        accountType: "mutual_fund",
        taxTreatment: "taxable",
        region: "India",
        currency: "INR",
        asOf,
      },
      holdings: mfHoldings,
      warnings: ["Depository CAS lists MF units without cost — import the detailed CAMS/KFintech CAS for purchase costs."],
      source,
    });
  }

  if (drafts.length === 0) {
    throw new Error(
      "This looks like an NSDL/CDSL statement but no holdings rows could be read from it. " +
        "If holdings show in the PDF, please report the layout.",
    );
  }
  return drafts;
}
