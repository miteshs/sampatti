// Document/screenshot → a reviewable ImportDraft, via Claude. A TS port of
// tally/backend/app/ai_import.py (prompt, JSON repair, validate), tuned for Indian
// statements (CAS/NSDL/CDSL demat, CAMS/KFintech MF, PMS, lakh/crore, ₹). The result is
// ALWAYS shown to the user for review before it touches the portfolio.

import { normAccountType, normAssetClass, normRegion, normTaxTreatment } from "../domain/classify";
import type { ImportDraft } from "../domain/types";
import { callClaude, EXTRACT_MODEL, type Block } from "../claude/transport";
import { normDate } from "./rows";

const PROMPT = `You extract holdings from an Indian (or foreign) brokerage / mutual-fund / PMS / bank / insurance statement, or a screenshot of one.
Return ONE JSON object of the form { "accounts": [ ... ] }, where each entry is ONE account matching EXACTLY this shape:

{
  "name": "account name (e.g. 'Zerodha Demat', 'HDFC MF Folio', 'Marcellus PMS')",
  "institution": "institution / AMC / broker name",
  "account_type": one of ["demat","mutual_fund","nps","epf_ppf","bank","pms_aif","foreign_broker","real_estate","liability","other"],
  "tax_treatment": one of ["taxable","eee_exempt","nps","na"],   // eee_exempt = PPF/EPF/SSY; nps = NPS; else taxable
  "region": "India" or "US" or country,
  "currency": "the statement's 3-letter currency code — 'USD' for US/dollar statements, 'INR' for Indian, etc.",
  "as_of": "YYYY-MM-DD" (the statement / valuation date),
  "holdings": [
    {
      "symbol": "ticker / ISIN / scheme code if shown (omit if none)",
      "name": "security or scheme name",
      "asset_class": one of ["indian_equity","equity_mf","index_etf","elss","debt_mf","nps","epf_ppf","fd_rd","structured_notes","gold_sgb","gold_other","reit_invit","us_equity","private_equity","private_credit","pms","insurance","crypto","real_estate","cash","other"],
      "units": number (omit if not applicable),
      "value": number (CURRENT market value in the account currency),
      "cost_basis": number (total invested / purchase cost, omit if not shown; if only a per-unit average cost is shown, multiply by units),
      "buy_date": "YYYY-MM-DD" (purchase / acquisition date if shown, omit otherwise)
    }
  ]
}

Rules:
- ACCOUNT SEGREGATION MATTERS. Most statements are ONE account → return a single entry in "accounts". But if the document clearly holds MULTIPLE distinct accounts — e.g. a Schwab/Fidelity "Positions for All-Accounts" / consolidated export where each account is its own section with a name header (often with a masked number like "...827") and its own holdings, or a CAS/NSDL statement spanning several demat/folio accounts — return ONE entry PER account. Put each account's own holdings under that account; NEVER merge holdings from different accounts together, and NEVER emit a section's "Positions Total" / subtotal as a holding.
- CURRENCY MATTERS — detect it, do not assume INR. Dollar amounts ($), a US broker (Fidelity, Schwab, Charles Schwab, Morgan Stanley, Robinhood, E*Trade, Vanguard, Merrill, Interactive Brokers), or US-listed tickers ⇒ currency "USD" and region "US". Indian (₹, lakh/crore, NSE/BSE/CAMS/KFintech) ⇒ "INR". Set currency to what the VALUES are actually denominated in.
- Statements often include PAGES of disclaimers/boilerplate — IGNORE them. Find the holdings table and the portfolio/account TOTAL. The "KEY LINES" block (if present) lists the lines with amounts and headers — use it.
- If ANY balance, position, or portfolio value appears, you MUST capture it. NEVER return an empty holdings list when a value is present.
- Extract EVERY position. value = current market value (not cost).
- A single-balance statement (PMS, pension, insurance surrender value, a flat) = ONE holding equal to the total/closing value.
- Indian numbers may use lakh/crore grouping like 1,08,31,366.11 — read them correctly. Strip ₹ , $ and spaces. Do NOT invent values you cannot read.
- Choose the closest asset_class: equity MF = "equity_mf"; tax-saver/ELSS = "elss"; liquid/debt/gilt fund = "debt_mf"; Sovereign Gold Bond = "gold_sgb"; gold ETF/physical = "gold_other"; PPF/EPF/VPF = "epf_ppf"; FD/RD/NCD/plain bond = "fd_rd"; market-linked note / structured product / MLD / autocallable / equity-linked note, or a bank-issued note with a 'DUE' maturity and a VAR/0%/odd coupon (e.g. "Morgan Stanley Fin VAR … DUE", "BNP Paribas 0% … DUE") = "structured_notes"; ULIP/endowment/LIC = "insurance"; RSU/ESPP/US stock = "us_equity"; private-equity / VC / buyout / private-markets fund = "private_equity"; private-credit / direct-lending / private-debt fund = "private_credit"; PMS / AIF / managed discretionary portfolio = "pms".
- Output ONLY the JSON object. No markdown, no commentary.`;

// ---- JSON repair (handles truncation from weaker/vision outputs) ----
function scan(s: string): [number, string[]] {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) return [i, []];
    }
  }
  return [-1, stack];
}

export function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?|```$/gm, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error(`No JSON object in model output: ${cleaned.slice(0, 200)}`);
  const frag = cleaned.slice(start);
  const [close, stack] = scan(frag);
  if (close >= 0) return JSON.parse(frag.slice(0, close + 1));
  let repair = frag.replace(/[\s,]+$/, "");
  repair += [...stack].reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  return JSON.parse(repair);
}

function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/[₹$,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Coerce raw model JSON into an ImportDraft, collecting warnings (mirrors ai_import.validate).
export function validateDraft(raw: unknown, source: string): ImportDraft {
  const acct = (raw ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const currency = String(acct.currency || "INR").toUpperCase();

  const [accountType, okType] = normAccountType(acct.account_type, "demat");
  const [tax, okTax] = normTaxTreatment(acct.tax_treatment ?? acct.tax_status, "taxable");
  if (!okType && acct.account_type) warnings.push(`account_type '${acct.account_type}' → 'demat'`);
  if (!okTax && acct.tax_treatment) warnings.push(`tax_treatment '${acct.tax_treatment}' → 'taxable'`);

  const holdingsRaw = Array.isArray(acct.holdings) ? acct.holdings : [];
  const holdings: ImportDraft["holdings"] = [];
  for (const hr of holdingsRaw) {
    const h = (hr ?? {}) as Record<string, unknown>;
    const value = num(h.value ?? h.market_value);
    if (!value) {
      warnings.push(`skipped holding with no value: ${h.name ?? h.symbol ?? "?"}`);
      continue;
    }
    const [cls, okCls] = normAssetClass(h.asset_class, "other");
    if (!okCls && h.asset_class) warnings.push(`asset_class '${h.asset_class}' on '${h.name}' → 'other'`);
    holdings.push({
      symbol: h.symbol ? String(h.symbol).trim().toUpperCase() : undefined,
      name: String(h.name || h.symbol || "—"),
      assetClass: cls,
      units: num(h.units ?? h.quantity),
      marketValue: Math.round(value * 100) / 100,
      costBasis: num(h.cost_basis),
      buyDate: normDate(h.buy_date, currency === "USD"),
      currency: h.currency ? String(h.currency).toUpperCase() : currency,
    });
  }
  if (holdings.length === 0) warnings.push("No holdings parsed — check the source document.");
  if (currency === "INR" && holdings.some((h) => h.assetClass === "us_equity")) {
    warnings.push("US stocks detected but currency is INR — switch this account to USD if the values are in dollars.");
  }

  return {
    account: {
      name: String(acct.name || "Imported account"),
      institution: String(acct.institution || "Manual"),
      accountType,
      taxTreatment: tax,
      region: normRegion(acct.region, "India")[0],
      currency,
      asOf: acct.as_of ? String(acct.as_of) : undefined,
    },
    holdings,
    warnings,
    source,
  };
}

// Model output → one draft per account. Accepts the multi-account { accounts: [...] } shape
// and, for back-compat, a bare single-account object.
export function validateDrafts(raw: unknown, source: string): ImportDraft[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(obj.accounts) && obj.accounts.length ? obj.accounts : [raw];
  return list.map((a) => validateDraft(a, source));
}

// Pull the financially-relevant lines so boilerplate doesn't bury the data (ai_import._focus).
const MONEY = /[\d][\d,]{2,}\.\d{2}|[₹$]\s?[\d,]+/;
const HEADERS = /\b(total|market value|portfolio value|closing balance|net asset|nav|balance|holding|position|symbol|isin|scheme|folio|units|quantity|cost|invested|account)\b/i;
// Account-section boundaries in consolidated exports — a masked number like "...827" or a
// common account label — so multi-account segregation survives the boilerplate filter.
const ACCT_SECTION = /\.{2,}\s*\d{3,}\b|\b(ira|roth|rollover|brokerage|demat)\b/i;

export function focus(text: string): string {
  const hot = text.split("\n").map((l) => l.trim()).filter((l) => l && (MONEY.test(l) || HEADERS.test(l) || ACCT_SECTION.test(l)));
  return hot.slice(0, 160).join("\n");
}

// Build the message content for a text statement or an image, and call Claude. Returns one
// draft per account the model finds (usually one; more for a consolidated multi-account export).
export async function extractFromText(text: string, source: string): Promise<ImportDraft[]> {
  const focused = focus(text);
  const payload =
    text.length > 6000 && focused
      ? "KEY LINES from the statement (amounts & headers; boilerplate omitted):\n" + focused
      : text;
  const content: Block[] = [{ type: "text", text: `${PROMPT}\n\n--- STATEMENT TEXT ---\n${payload.slice(0, 24000)}` }];
  const out = await callClaude({ model: EXTRACT_MODEL, max_tokens: 4000, messages: [{ role: "user", content }] });
  return validateDrafts(extractJson(out), source);
}

export async function extractFromImage(mediaType: string, base64: string, source: string): Promise<ImportDraft[]> {
  const content: Block[] = [
    { type: "text", text: PROMPT },
    { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
  ];
  const out = await callClaude({ model: EXTRACT_MODEL, max_tokens: 4000, messages: [{ role: "user", content }] });
  return validateDrafts(extractJson(out), source);
}
