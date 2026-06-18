// NSDL / CDSL depository CAS → ImportDrafts, parsed ENTIRELY on this device (like the
// CAMS CAS in cas.ts — this is the other half of the India activation story: the monthly
// e-CAS lists EVERY demat holding across both depositories plus MF folios and AIF units).
//
// Layout reality: the depositories vary the tables month to month, so this parser anchors
// on what never changes — ISINs. An equity row carries an INE… ISIN and a numeric tail in
// which SOME (quantity, price, value) triple must satisfy qty × price ≈ value; rows that
// can't produce a consistent triple (subtotals, headers) are skipped. Demat accounts become
// separate draft accounts (one per DP); the MF folio section lands in the SAME canonical
// "Mutual Funds — CAS" account the CAMS parser uses, so importing both kinds of CAS
// converges on one MF account via the normal update-match instead of duplicating.
//
// Beyond holdings we now read the ACCOUNT HOLDER name(s) off each section — a demat account
// or a folio can be sole or joint — so an imported account shows whose it is, and joint
// accounts can be flagged (isJoint). Joint MF folios are kept as their own account rather
// than merged into the sole-held pile. Value is always shown in full (no share-splitting).

import { holderSummary, type AccountType, type AssetClass, type ImportDraft } from "../domain/types";
import { mfClassFromName } from "./cas";

const INE = /\bINE[A-Z0-9]{9}\b/; // demat instruments
const INF = /\bINF[A-Z0-9]{9}\b/; // MF folios (statement-of-account form)
const NUM = /[\d,]+\.?\d*/g;
const num = (s: string): number => parseFloat(s.replace(/,/g, ""));
const round2 = (v: number): number => Math.round(v * 100) / 100;

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
  if (/\baif\b|alternative investment fund|\bcategory\s+(i{1,3}|[123])\b/.test(n)) return "pms";
  if (/\bmld\b|market[- ]linked|structured note/.test(n)) return "structured_notes";
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

// Holder name(s) off a CAS line: "First / Sole Holder : ARJUN MEHTA", "Second Holder: PRIYA
// MEHTA", or a combined "Holder(s): ARJUN MEHTA, PRIYA MEHTA". One holder per line is the
// common form; the combined form is split on , & / and. Returns null when the line isn't a
// holder line (no "holder … : <name>"), so account-ID / status lines are left alone.
export function holdersFromLine(line: string): string[] | null {
  const m = line.match(/\bholders?(?:\(s\))?\s*(?:names?)?\s*[:\-]\s*(.+)$/i);
  if (!m) return null;
  const names = m[1]
    .split(/\s*(?:,|&|\/|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && /[A-Za-z]/.test(s) && !/\d/.test(s) && !/^(active|inactive|status)\b/i.test(s));
  return names.length ? names : null;
}

interface Acc {
  name: string;
  institution: string;
  accountType: AccountType;
  depository?: "NSDL" | "CDSL";
  holders: string[];
  holdings: ImportDraft["holdings"];
}

const addHolders = (acc: Acc, names: string[]): void => {
  for (const n of names) if (!acc.holders.includes(n)) acc.holders.push(n);
};

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

  type Section = "demat" | "mf" | "aif";
  let section: Section = "demat";
  let depo: "NSDL" | "CDSL" = "NSDL";
  let cur: Acc | null = null; // current demat account
  let aifAcc: Acc | null = null; // current AIF account
  let mfHolders: string[] = []; // holders of the folio currently being read

  const demat: Acc[] = [];
  const aifs: Acc[] = [];
  // "" = the canonical sole-held MF account (same identity as the CAMS CAS); any other key is
  // a joint folio's holder-signature, kept as its own account so it isn't merged with sole funds.
  const mfAccounts = new Map<string, Acc>();

  const ensureDemat = (): Acc => {
    if (!cur) {
      cur = { name: `Demat (${depo})`, institution: `Demat (${depo})`, accountType: "demat", depository: depo, holders: [], holdings: [] };
      demat.push(cur);
    }
    return cur;
  };
  const ensureAif = (): Acc => {
    if (!aifAcc) {
      aifAcc = { name: "Alternative Investment Funds", institution: "AIF", accountType: "pms_aif", holders: [], holdings: [] };
      aifs.push(aifAcc);
    }
    return aifAcc;
  };

  for (const line of all) {
    // A real section header never carries an ISIN — guard against holding rows whose NAME
    // contains a section keyword (e.g. "EVERGREEN ALTERNATIVE INVESTMENT FUND …") being
    // mistaken for the start of a section and dropped.
    const hasIsin = INE.test(line) || INF.test(line);

    // ---- section context ----
    if (!hasIsin && /HELD WITH NSDL|NSDL Demat Account/i.test(line)) { depo = "NSDL"; section = "demat"; cur = null; continue; }
    if (!hasIsin && /HELD WITH CDSL|CDSL Demat Account/i.test(line)) { depo = "CDSL"; section = "demat"; cur = null; continue; }
    if (!hasIsin && /ALTERNATIVE INVESTMENT FUND|\bAIF\s+(?:HOLDINGS|UNITS|SCHEMES|PORTFOLIO)/i.test(line)) { section = "aif"; aifAcc = null; continue; }
    if (!hasIsin && /MUTUAL FUND FOLIOS|MUTUAL FUND UNITS|\bMF\s+FOLIOS/i.test(line)) { section = "mf"; mfHolders = []; continue; }

    // ---- MF folio boundary: a new folio resets the holder context (checked before the generic
    // holder line so a combined "Folio No … Holder: X" line resets AND captures on the same line).
    if (section === "mf" && /\bFolio\s*(No\.?|Number)\b/i.test(line) && !INF.test(line)) {
      mfHolders = [];
      const h = holdersFromLine(line);
      if (h) mfHolders.push(...h);
      continue;
    }

    // ---- holder lines (attach to the current section's owner) ----
    if (!INE.test(line) && !INF.test(line)) {
      const hs = holdersFromLine(line);
      if (hs) {
        if (section === "aif") addHolders(ensureAif(), hs);
        else if (section === "mf") { for (const n of hs) if (!mfHolders.includes(n)) mfHolders.push(n); }
        else addHolders(ensureDemat(), hs);
        continue;
      }
    }

    // ---- demat account header (DP name / IDs start a new draft account) ----
    if (section === "demat") {
      const dp = line.match(/DP Name\s*:?\s*(.+?)(?:\s*DP ID|$)/i);
      if (dp && dp[1].trim().length > 2) {
        const inst = dp[1].trim().replace(/\s+/g, " ");
        cur = { name: `${inst} Demat`, institution: inst, accountType: "demat", depository: depo, holders: [], holdings: [] };
        demat.push(cur);
        continue;
      }
      if (/\bDP ID\b|\bClient ID\b|\bBO ID\b/i.test(line) && !INE.test(line)) { ensureDemat(); continue; }
    }

    // ---- MF folio rows — INF ISINs ----
    const inf = line.match(INF);
    if (inf) {
      const tail = (line.match(NUM) ?? []).map(num).filter((n) => Number.isFinite(n));
      const triple = rowTriple(tail.slice(-6));
      if (!triple) continue;
      const name = line
        .replace(INF, "")
        .replace(/Folio\s*(No\.?)?\s*:?\s*[\w/ -]*/i, "")
        .replace(NUM, "")
        .replace(/[|·]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (name.length <= 3) continue;
      const holding = { symbol: inf[0], name, assetClass: mfClassFromName(name), units: triple.units, marketValue: round2(triple.value), currency: "INR" };
      if (section === "aif") { ensureAif().holdings.push({ ...holding, assetClass: "pms" }); continue; }
      // Sole-held folios merge into the canonical MF account; joint folios split out by holders.
      const joint = mfHolders.length > 1;
      const key = joint ? mfHolders.join("|") : "";
      let acc = mfAccounts.get(key);
      if (!acc) {
        acc = joint
          ? { name: `Mutual Funds — CAS · Joint (${holderSummary(mfHolders)})`, institution: "CAMS / KFintech", accountType: "mutual_fund", holders: [...mfHolders], holdings: [] }
          : { name: "Mutual Funds — CAS", institution: "CAMS / KFintech", accountType: "mutual_fund", holders: [], holdings: [] };
        mfAccounts.set(key, acc);
      }
      if (!joint && mfHolders.length === 1) addHolders(acc, mfHolders);
      acc.holdings.push(holding);
      continue;
    }

    // ---- demat / AIF instrument rows — INE ISINs ----
    const ine = line.match(INE);
    if (ine) {
      const tail = (line.match(NUM) ?? []).map(num).filter((n) => Number.isFinite(n));
      const triple = rowTriple(tail.slice(-6));
      if (!triple) continue; // subtotal / unparseable row
      const name = line.replace(INE, "").replace(NUM, "").replace(/\s+/g, " ").trim();
      if (name.length < 3) continue;
      const cls = dematClassFromName(name);
      const holding = { symbol: ine[0], name, assetClass: cls, units: triple.units, marketValue: round2(triple.value), currency: "INR" };
      // AIF units (whether in a dedicated AIF section or detected by name) read as their own
      // managed account so alternatives don't masquerade as ordinary demat equity.
      if (section === "aif" || cls === "pms") ensureAif().holdings.push({ ...holding, assetClass: "pms" });
      else ensureDemat().holdings.push(holding);
    }
  }

  const drafts: ImportDraft[] = [];
  const push = (a: Acc, warnings: string[]): void => {
    if (a.holdings.length === 0) return;
    drafts.push({
      account: {
        name: a.name,
        institution: a.institution,
        accountType: a.accountType,
        taxTreatment: "taxable",
        region: "India",
        currency: "INR",
        asOf,
        holders: a.holders.length ? a.holders : undefined,
      },
      holdings: a.holdings,
      warnings,
      source,
    });
  };

  for (const a of demat) push(a, [`From the ${a.depository} consolidated statement — prices as of the statement date.`]);
  for (const a of aifs) push(a, ["Alternative Investment Fund units from the depository CAS — valued at the statement's reported value."]);
  // Canonical (sole-held) MF account first, then any joint folio accounts.
  const canonical = mfAccounts.get("");
  if (canonical) push(canonical, ["Depository CAS lists MF units without cost — import the detailed CAMS/KFintech CAS for purchase costs."]);
  for (const [key, a] of mfAccounts) {
    if (key === "") continue;
    push(a, ["Joint MF folio(s) from the depository CAS — kept separate from your sole-held funds; values shown in full."]);
  }

  if (drafts.length === 0) {
    throw new Error(
      "This looks like an NSDL/CDSL statement but no holdings rows could be read from it. " +
        "If holdings show in the PDF, please report the layout.",
    );
  }
  return drafts;
}
