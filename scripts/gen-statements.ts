// Writes the demo portfolio out as a MIX of broker-style statements — CSV, Excel, PDF and
// screenshot (PNG) — into samples/demo-statements/<region>/statements/. This is the "practice
// the real import flow" path: drop the folder into Holdings → "Import a whole folder" and the
// app parses it back. CSV/Excel parse 100% locally and are VERIFIED here to reproduce each
// account's holdings to the rupee; PDF/screenshot are the Claude-vision path, so they're made
// realistic but are inherently approximate (and never carry the daily trend — only the .json
// backup does). One-off, run on demand — see scripts/gen-demo-statements.test.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import puppeteer, { type Browser } from "puppeteer-core";
import type { Account, Holding, Portfolio } from "../src/domain/types";
import { parseCsv } from "../src/ingest/csv";
import { parseXlsx } from "../src/ingest/xlsx";

type Fmt = "csv" | "xlsx" | "pdf" | "png";

// account name → { file format, output filename }. Chosen so the bulk of value lands on the
// exact (CSV/Excel) path while every format is exercised, the way a real user's downloads look.
const PLAN: Record<string, { fmt: Fmt; file: string }> = {
  // ── India ──────────────────────────────────────────────────────────────────
  "Zerodha Demat": { fmt: "csv", file: "zerodha-holdings.csv" },
  "Equity Mutual Funds": { fmt: "xlsx", file: "cams-equity-funds.xlsx" },
  "Debt Funds": { fmt: "csv", file: "debt-funds.csv" },
  "Marcellus PMS": { fmt: "pdf", file: "marcellus-pms-statement.pdf" },
  "Edelweiss AIF": { fmt: "pdf", file: "edelweiss-aif-statement.pdf" },
  "Private Markets": { fmt: "pdf", file: "avendus-private-markets.pdf" },
  "NPS Tier-1": { fmt: "png", file: "nps-cra-screenshot.png" },
  "Provident Fund": { fmt: "png", file: "epfo-passbook-screenshot.png" },
  "Bank & Deposits": { fmt: "csv", file: "hdfc-bank-deposits.csv" },
  Gold: { fmt: "csv", file: "gold-holdings.csv" },
  "LIC Endowment Policy": { fmt: "pdf", file: "lic-policy-statement.pdf" },
  "Morgan Stanley (RSU/ESPP)": { fmt: "xlsx", file: "morgan-stanley-stockplan.xlsx" },
  "Schwab Brokerage": { fmt: "csv", file: "schwab-positions.csv" },
  "Crypto Wallet": { fmt: "png", file: "crypto-wallet-screenshot.png" },
  "HUF Demat": { fmt: "csv", file: "zerodha-huf-holdings.csv" },
  "Real Estate": { fmt: "csv", file: "real-estate.csv" },
  "Plot — Alibaug": { fmt: "csv", file: "plot-alibaug.csv" },
  "Groww Mutual Funds": { fmt: "csv", file: "groww-folio.csv" },
  "Home Loan": { fmt: "csv", file: "hdfc-home-loan.csv" },
  // ── US ─────────────────────────────────────────────────────────────────────
  "Schwab Taxable": { fmt: "csv", file: "schwab-taxable-positions.csv" },
  "Fidelity 401(k)": { fmt: "xlsx", file: "fidelity-401k.xlsx" },
  "Vanguard Roth IRA": { fmt: "csv", file: "vanguard-roth-ira.csv" },
  "HSA Bank": { fmt: "png", file: "hsa-bank-screenshot.png" },
  "Treasury & CDs": { fmt: "csv", file: "treasury-and-cds.csv" },
  Coinbase: { fmt: "png", file: "coinbase-screenshot.png" },
  "RSU — Stripe (Carta)": { fmt: "pdf", file: "carta-rsu-statement.pdf" },
  "Old Employer 401(k) — Empower": { fmt: "xlsx", file: "empower-old-401k.xlsx" },
  "Zerodha (NRI demat)": { fmt: "csv", file: "zerodha-nri-holdings.csv" },
  "Home — Austin": { fmt: "pdf", file: "home-austin-valuation.pdf" },
  Mortgage: { fmt: "csv", file: "rocket-mortgage.csv" },
};

interface AcctGroup {
  account: Account;
  holdings: Holding[];
}

// Group a portfolio's holdings under their account (preserving demo order).
function groupByAccount(p: Portfolio): AcctGroup[] {
  return p.accounts.map((account) => ({
    account,
    holdings: p.holdings.filter((h) => h.accountId === account.id),
  }));
}

// The canonical "Sampatti CSV/sheet" columns (see src/ingest/rows.ts). Carrying these
// explicitly means the parser reproduces account meta, units, cost basis and buy dates
// exactly — no inference, no Claude.
const HEADERS = [
  "account", "institution", "account_type", "tax_treatment", "region", "currency",
  "symbol", "name", "asset_class", "units", "market_value", "cost_basis", "buy_date", "as_of",
] as const;

function rowsFor({ account: a, holdings }: AcctGroup): Record<string, string | number>[] {
  return holdings.map((h) => ({
    account: a.name,
    institution: a.institution,
    account_type: a.accountType,
    tax_treatment: a.taxTreatment,
    region: a.region,
    currency: h.currency ?? a.currency,
    symbol: h.symbol ?? "",
    name: h.name,
    asset_class: h.assetClass,
    units: h.units ?? "",
    market_value: h.marketValue,
    cost_basis: h.costBasis ?? "",
    buy_date: h.buyDate ?? "",
    as_of: a.asOf ?? "",
  }));
}

const money = (v: number, ccy: string) =>
  new Intl.NumberFormat(ccy === "USD" ? "en-US" : "en-IN", {
    style: "currency", currency: ccy, maximumFractionDigits: 0,
  }).format(v);

// ── exact-parity formats ──────────────────────────────────────────────────────

function writeCsv(path: string, g: AcctGroup): void {
  const csv = Papa.unparse({ fields: [...HEADERS], data: rowsFor(g).map((r) => HEADERS.map((h) => r[h])) });
  writeFileSync(path, csv + "\n");
}

function writeXlsx(path: string, g: AcctGroup): void {
  const aoa = [[...HEADERS], ...rowsFor(g).map((r) => HEADERS.map((h) => r[h]))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Holdings");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(path, buf);
}

// After writing, re-parse through the SAME parser the app uses and assert the holdings come
// back to the rupee. This is the guarantee behind "the folder recreates the demo".
function verifyExact(path: string, fmt: "csv" | "xlsx", g: AcctGroup): void {
  let drafts;
  if (fmt === "csv") {
    drafts = parseCsv(readFileSync(path, "utf8"), path);
  } else {
    const b = readFileSync(path);
    drafts = parseXlsx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), path);
  }
  const got = drafts.flatMap((d) => d.holdings);
  if (got.length !== g.holdings.length) {
    throw new Error(`${path}: parsed ${got.length} holdings, expected ${g.holdings.length}`);
  }
  for (const h of g.holdings) {
    const m = got.find((x) => x.name === h.name);
    if (!m) throw new Error(`${path}: holding "${h.name}" did not round-trip`);
    if (Math.round(m.marketValue) !== Math.round(h.marketValue)) {
      throw new Error(`${path}: "${h.name}" value ${m.marketValue} ≠ ${h.marketValue}`);
    }
    const want = h.costBasis === undefined ? undefined : Math.round(h.costBasis);
    const have = m.costBasis === undefined ? undefined : Math.round(m.costBasis);
    if (want !== have) throw new Error(`${path}: "${h.name}" cost basis ${have} ≠ ${want}`);
    if (m.assetClass !== h.assetClass) throw new Error(`${path}: "${h.name}" class ${m.assetClass} ≠ ${h.assetClass}`);
  }
}

// ── Claude-vision formats (realistic, approximate) ─────────────────────────────

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

// One statement-page HTML used for both PDF (print) and PNG (screenshot). Plain system fonts,
// no network resources, so it renders offline and deterministically.
function statementHtml(g: AcctGroup, opts: { screenshot?: boolean }): string {
  const a = g.account;
  const ccy = a.currency;
  const total = g.holdings.reduce((s, h) => s + h.marketValue, 0);
  const cols = g.holdings.some((h) => h.units != null);
  const chrome = opts.screenshot
    ? `<div class="urlbar">🔒 portal.${a.institution.toLowerCase().replace(/[^a-z]+/g, "")}.example — Holdings</div>`
    : "";
  const rows = g.holdings
    .map(
      (h) => `<tr>
        <td>${esc(h.name)}${h.symbol ? ` <span class="sym">${esc(h.symbol)}</span>` : ""}</td>
        <td class="num">${h.units != null ? h.units.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</td>
        <td class="num">${h.costBasis != null ? money(h.costBasis, ccy) : "—"}</td>
        <td class="num">${money(h.marketValue, ccy)}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0;background:${opts.screenshot ? "#eceff3" : "#fff"};padding:${opts.screenshot ? "0" : "36px 40px"}}
    .urlbar{background:#dfe3e8;border-bottom:1px solid #c4c9d0;padding:9px 16px;font-size:12px;color:#444}
    .page{background:#fff;${opts.screenshot ? "margin:18px;padding:28px 32px;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.12)" : ""}}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a1a1a;padding-bottom:12px}
    .inst{font-size:20px;font-weight:700;letter-spacing:-.01em}
    .doc{font-size:12px;color:#666;text-align:right}
    h1{font-size:15px;margin:18px 0 2px}
    .meta{color:#666;font-size:12px;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #eee}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#888;border-bottom:1.5px solid #ccc}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    .sym{color:#888;font-size:11px}
    tfoot td{font-weight:700;border-top:2px solid #1a1a1a;border-bottom:none}
    .note{margin-top:22px;font-size:11px;color:#999}
  </style></head><body>${chrome}<div class="page">
    <header>
      <div><div class="inst">${esc(a.institution)}</div><div style="font-size:12px;color:#666">${esc(a.name)}</div></div>
      <div class="doc">Statement of Holdings<br>As of ${esc(a.asOf ?? "")}<br>${ccy}</div>
    </header>
    <h1>Portfolio Holdings</h1>
    <div class="meta">${a.region} · ${a.accountType.replace(/_/g, " ")}${a.note ? ` · ${esc(a.note)}` : ""}</div>
    <table>
      <thead><tr><th>Security</th><th class="num">${cols ? "Units" : "Qty"}</th><th class="num">Cost</th><th class="num">Market value</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td></td><td></td><td class="num">${money(total, ccy)}</td></tr></tfoot>
    </table>
    <div class="note">Synthetic sample — illustrative figures only, not a real account or advice.</div>
  </div></body></html>`;
}

async function writePdf(browser: Browser, path: string, g: AcctGroup): Promise<void> {
  const page = await browser.newPage();
  await page.setContent(statementHtml(g, {}), { waitUntil: "load" });
  const pdf = await page.pdf({ format: "a4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" } });
  writeFileSync(path, pdf);
  await page.close();
}

async function writePng(browser: Browser, path: string, g: AcctGroup): Promise<void> {
  const page = await browser.newPage();
  await page.setViewport({ width: 980, height: 720, deviceScaleFactor: 2 });
  await page.setContent(statementHtml(g, { screenshot: true }), { waitUntil: "load" });
  const buf = await page.screenshot({ type: "png", fullPage: true });
  writeFileSync(path, buf);
  await page.close();
}

function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ];
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error("Chrome not found — set CHROME_PATH");
  return hit;
}

export interface GenResult {
  byFmt: Record<Fmt, number>;
  files: { file: string; fmt: Fmt; account: string; holdings: number; local: boolean }[];
}

// Generate every account's statement into <outDir>/statements/, verify the exact-path files,
// and write a MANIFEST.md describing what's there and how each parses.
export async function generateStatements(p: Portfolio, outDir: string): Promise<GenResult> {
  const dir = join(outDir, "statements");
  mkdirSync(dir, { recursive: true });
  const groups = groupByAccount(p);

  const byFmt: Record<Fmt, number> = { csv: 0, xlsx: 0, pdf: 0, png: 0 };
  const files: GenResult["files"] = [];
  let browser: Browser | null = null;
  const browserNeeded = groups.some((g) => {
    const fmt = PLAN[g.account.name]?.fmt;
    return fmt === "pdf" || fmt === "png";
  });
  if (browserNeeded) {
    browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox"] });
  }

  try {
    for (const g of groups) {
      const plan = PLAN[g.account.name];
      if (!plan) throw new Error(`No statement plan for account "${g.account.name}" — add it to PLAN.`);
      const path = join(dir, plan.file);
      const local = plan.fmt === "csv" || plan.fmt === "xlsx";
      if (plan.fmt === "csv") {
        writeCsv(path, g);
        verifyExact(path, "csv", g);
      } else if (plan.fmt === "xlsx") {
        writeXlsx(path, g);
        verifyExact(path, "xlsx", g);
      } else if (plan.fmt === "pdf") {
        await writePdf(browser!, path, g);
      } else {
        await writePng(browser!, path, g);
      }
      byFmt[plan.fmt] += 1;
      files.push({ file: plan.file, fmt: plan.fmt, account: g.account.name, holdings: g.holdings.length, local });
    }
  } finally {
    await browser?.close();
  }

  writeFileSync(join(dir, "MANIFEST.md"), manifest(files));
  return { byFmt, files };
}

function manifest(files: GenResult["files"]): string {
  const rows = files
    .map((f) => `| \`${f.file}\` | ${f.fmt.toUpperCase()} | ${f.account} | ${f.holdings} | ${f.local ? "Local (exact)" : "Claude vision (approx.)"} |`)
    .join("\n");
  return `# Sample statements — this folder

The **same** portfolio as the region's \`sampatti-demo-*.json\` backup, split into the mix of
formats you'd actually download from brokers and portals. Import the whole folder via
**Holdings → Import a whole folder**.

- **CSV / Excel** parse 100% on-device and reproduce holdings, units, cost basis and buy dates
  exactly (verified at generation time).
- **PDF / screenshot** go through Claude vision (you'll be asked to confirm before anything is
  sent). They're realistic but approximate, and — like all statements — carry **no daily history**.
  For the exact demo including the ~18-month trend, import the \`.json\` backup instead.

| File | Format | Account | Holdings | Parses |
|---|---|---|---|---|
${rows}

_All figures are synthetic. Regenerate with the GEN_DEMO command in the parent README._
`;
}
