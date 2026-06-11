// Synthetic statement fixtures for the local-AI extraction eval (docs/local-ai.md Phase 2).
// Six Indian-portfolio archetypes rendered across CSV / XLSX / PDF / PNG with EXACT ground
// truth written alongside (the generator knows the numbers because it invented them).
// Everything is synthetic: fake folios, no PAN/ISIN/Aadhaar shapes, no real person.
//
//   node scripts/eval/gen-fixtures.mjs          writes scripts/eval/fixtures/ + manifest.json
//
// CSV/XLSX fixtures deliberately use NON-standard headers so the deterministic parsers
// refuse them — these statements exist to exercise the AI path, not the happy path.
// PNGs (screenshots) are Claude-tier by design (the on-device model is text-only); they're
// generated for vision-eval completeness and routing assertions, not the local eval.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "scripts", "eval", "fixtures");
mkdirSync(OUT, { recursive: true });

// Indian digit grouping (1,08,31,366.11) — statements use it, the model must read it.
const inGroup = (n) => {
  const [i, d] = n.toFixed(2).split(".");
  const head = i.slice(0, -3);
  const tail = i.slice(-3);
  const grouped = head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail : tail;
  return `${grouped}.${d}`;
};
const usGroup = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- the six archetypes (values chosen to sum cleanly; truth recorded exactly) ---------

const DEMAT = {
  id: "demat-equity",
  account: { name: "Apex Securities Demat", institution: "Apex Securities", account_type: "demat", currency: "INR" },
  holdings: [
    { name: "Reliance Industries", units: 120, cost: 285000, value: 352800 },
    { name: "HDFC Bank", units: 300, cost: 432000, value: 511500 },
    { name: "Infosys", units: 150, cost: 201000, value: 247350 },
    { name: "Tata Consultancy Services", units: 60, cost: 192000, value: 219840 },
    { name: "ITC", units: 800, cost: 268000, value: 342400 },
    { name: "Larsen & Toubro", units: 90, cost: 198000, value: 308700 },
    { name: "Asian Paints", units: 110, cost: 319000, value: 286000 },
    { name: "Tata Motors", units: 250, cost: 112500, value: 198750 },
  ],
};

const MF = {
  id: "mf-statement",
  account: { name: "WealthServe MF Holdings", institution: "WealthServe", account_type: "mutual_fund", currency: "INR" },
  holdings: [
    { name: "Parag Parikh Flexi Cap Fund - Direct Growth", folio: "SYN/901234", units: 4210.553, nav: 78.42, value: 330191.56, cost: 240000 },
    { name: "HDFC Mid-Cap Opportunities Fund - Direct Growth", folio: "SYN/884511", units: 1822.114, nav: 172.31, value: 313968.46, cost: 210000 },
    { name: "SBI Bluechip Fund - Regular Growth", folio: "SYN/772390", units: 3150.221, nav: 89.07, value: 280590.18, cost: 235000 },
    { name: "Axis ELSS Tax Saver Fund - Direct Growth", folio: "SYN/660082", units: 2410.873, nav: 95.66, value: 230624.11, cost: 180000 },
    { name: "UTI Nifty 50 Index Fund - Direct Growth", folio: "SYN/550017", units: 1505.66, nav: 158.2, value: 238195.41, cost: 190000 },
    { name: "ICICI Prudential Liquid Fund - Direct Growth", folio: "SYN/449903", units: 612.004, nav: 372.55, value: 228002.09, cost: 220000 },
  ],
};

const FD = {
  id: "bank-fd",
  account: { name: "Suvarna Bank Deposits", institution: "Suvarna Bank", account_type: "bank", currency: "INR" },
  holdings: [
    { name: "Fixed Deposit SYN-71001", value: 500000, rate: "7.10%", maturity: "12-Mar-2027" },
    { name: "Fixed Deposit SYN-71002", value: 300000, rate: "7.25%", maturity: "30-Sep-2026" },
    { name: "Fixed Deposit SYN-71003", value: 750000, rate: "6.90%", maturity: "18-Jan-2028" },
    { name: "Tax Saver FD SYN-71004", value: 150000, rate: "6.75%", maturity: "05-Jul-2030" },
  ],
};

const PMS = {
  id: "pms-letter",
  account: { name: "Meridian PMS", institution: "Meridian Portfolio Managers", account_type: "pms_aif", currency: "INR" },
  holdings: [{ name: "Meridian Growth Portfolio", value: 12750000, cost: 10000000 }],
};

const US = {
  id: "us-broker",
  account: { name: "Lakeshore Brokerage", institution: "Lakeshore Securities", account_type: "foreign_broker", currency: "USD" },
  holdings: [
    { name: "Apple Inc (AAPL)", units: 40, cost: 6480, value: 9252 },
    { name: "Microsoft Corp (MSFT)", units: 25, cost: 7950, value: 11385.5 },
    { name: "NVIDIA Corp (NVDA)", units: 30, cost: 3660, value: 5511 },
    { name: "Alphabet Inc (GOOGL)", units: 35, cost: 4795, value: 6419 },
    { name: "Vanguard S&P 500 ETF (VOO)", units: 18, cost: 7020, value: 9889.2 },
  ],
};

const NPS = {
  id: "nps-statement",
  account: { name: "NPS Tier I", institution: "Sahyadri Pension Fund", account_type: "nps", currency: "INR" },
  holdings: [
    { name: "Scheme E - Tier I (Equity)", units: 9120.442, nav: 52.31, value: 477090.32 },
    { name: "Scheme C - Tier I (Corporate Bonds)", units: 5210.118, nav: 41.77, value: 217626.63 },
    { name: "Scheme G - Tier I (Govt Securities)", units: 6404.31, nav: 38.92, value: 249255.74 },
  ],
};

// ---- renderers --------------------------------------------------------------------------

// CSV with deliberately non-standard headers (deterministic parser must refuse → AI path).
function dematCsv(a) {
  const lines = [
    `${a.account.institution} - Holdings Snapshot as on 31-May-2026`,
    `Client: SYN-CLIENT-42,Segment: Equity`,
    ``,
    `Scrip,Qty. Held,Avg. Buy Rate,Purchase Val.,Mkt. Rate,Holding Val.,Unrealized P&L`,
    ...a.holdings.map((h) => {
      const avg = h.cost / h.units, ltp = h.value / h.units;
      return `${h.name},${h.units},${avg.toFixed(2)},${inGroup(h.cost)},"${ltp.toFixed(2)}","${inGroup(h.value)}","${inGroup(h.value - h.cost)}"`;
    }),
    ``,
    `,,,Total:,,"${inGroup(a.holdings.reduce((s, h) => s + h.value, 0))}",`,
  ];
  return lines.join("\n");
}

function fdCsv(a) {
  const lines = [
    `${a.account.institution} — Term Deposit Summary (31/05/2026)`,
    ``,
    `Deposit Ref.,Booked Amt (Rs),Int. Rate,Maturity Dt,Balance O/S (Rs)`,
    ...a.holdings.map((h) => `${h.name},${inGroup(h.value)},${h.rate},${h.maturity},${inGroup(h.value)}`),
    ``,
    `Total Relationship Value (Rs),"${inGroup(a.holdings.reduce((s, h) => s + h.value, 0))}"`,
  ];
  return lines.join("\n");
}

// XLSX with title/blank rows and odd headers (so parseXlsx finds no recognizable table).
function mfXlsx(a) {
  const rows = [
    [`${a.account.institution} Consolidated Holding Statement`],
    ["Statement Period: 01-Apr-2026 to 31-May-2026"],
    [],
    ["Scheme Name", "Folio Ref", "Closing Units", "Applicable NAV (Rs)", "Valuation (Rs)", "Amount Invested (Rs)"],
    ...a.holdings.map((h) => [h.name, h.folio, h.units, h.nav, h.value, h.cost]),
    [],
    ["", "", "", "Portfolio Valuation", a.holdings.reduce((s, h) => s + h.value, 0), ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Holdings");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function usXlsx(a) {
  const rows = [
    [`${a.account.institution} — Positions for account SYN...4427`],
    ["As of close 05/30/2026, values in USD"],
    [],
    ["Security Description", "Shares", "Cost Basis ($)", "Market Val ($)", "Gain/Loss ($)"],
    ...a.holdings.map((h) => [h.name, h.units, h.cost, h.value, h.value - h.cost]),
    [],
    ["Account Total", "", "", a.holdings.reduce((s, h) => s + h.value, 0), ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Positions");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ---- minimal text PDF writer (Helvetica, one page per 60 lines, pdf.js-extractable) -----
function textPdf(lines) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const pages = [];
  for (let i = 0; i < lines.length; i += 60) pages.push(lines.slice(i, i + 60));
  const objs = [];
  const pageRefs = pages.map((_, i) => `${5 + i * 2} 0 R`);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
  pages.forEach((pg, i) => {
    const content = [
      "BT /F1 9 Tf 40 752 Td 12 TL",
      ...pg.map((l, j) => `(${esc(l)}) Tj T*${j === 0 ? "" : ""}`),
      "ET",
    ].join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj ${objs[i]} endobj\n`;
  }
  const xref = body.length;
  let x = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) x += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += x + `trailer << /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

function mfPdfLines(a) {
  const total = a.holdings.reduce((s, h) => s + h.value, 0);
  return [
    `${a.account.institution} Mutual Fund Services`,
    `Consolidated Account Statement (synthetic eval fixture)`,
    `Period: 01-Apr-2026 to 31-May-2026          Statement Date: 31-May-2026`,
    ``,
    `This statement lists your mutual fund holdings serviced by ${a.account.institution}.`,
    `All values in Rs. unless stated otherwise.`,
    ``,
    `Scheme                                            Folio        Units        NAV (Rs)     Value (Rs)      Invested (Rs)`,
    `-----------------------------------------------------------------------------------------------------------------------`,
    ...a.holdings.map((h) =>
      `${h.name.padEnd(50)}${h.folio.padEnd(13)}${String(h.units).padEnd(13)}${h.nav.toFixed(2).padEnd(13)}${inGroup(h.value).padEnd(16)}${inGroup(h.cost)}`),
    `-----------------------------------------------------------------------------------------------------------------------`,
    `Portfolio Total                                                                          ${inGroup(total)}`,
    ``,
    `Note: Past performance is not indicative of future returns. This is a computer`,
    `generated statement and does not require a signature. Please review the holdings`,
    `and report discrepancies within 30 days. Mutual fund investments are subject to`,
    `market risks. Read all scheme related documents carefully before investing.`,
  ];
}

function fdPdfLines(a) {
  const total = a.holdings.reduce((s, h) => s + h.value, 0);
  return [
    `${a.account.institution}`,
    `Term Deposit Portfolio Summary as on 31-May-2026 (synthetic eval fixture)`,
    ``,
    `Deposit Reference          Principal (Rs)    Rate      Maturity Date    Current Balance (Rs)`,
    `--------------------------------------------------------------------------------------------`,
    ...a.holdings.map((h) =>
      `${h.name.padEnd(27)}${inGroup(h.value).padEnd(18)}${h.rate.padEnd(10)}${h.maturity.padEnd(17)}${inGroup(h.value)}`),
    `--------------------------------------------------------------------------------------------`,
    `Total Deposits: Rs ${inGroup(total)}`,
    ``,
    `Interest is compounded quarterly and paid at maturity. Premature withdrawal`,
    `attracts a penalty of 1% on the applicable rate. Deposits are insured per DICGC norms.`,
  ];
}

function pmsPdfLines(a) {
  const h = a.holdings[0];
  return [
    `${a.account.institution}`,
    `Quarterly Performance Letter — Q4 FY 2025-26 (synthetic eval fixture)`,
    ``,
    `Dear Investor,`,
    ``,
    `We are pleased to share the performance of your ${h.name} for the quarter`,
    `ended 31 March 2026. Markets remained constructive through the quarter with`,
    `broad participation across sectors.`,
    ``,
    `Portfolio value as on 31-May-2026:    Rs. ${inGroup(h.value)}`,
    `Capital contributed since inception:  Rs. ${inGroup(h.cost)}`,
    `Inception date: 14-Aug-2021`,
    ``,
    `Your portfolio remains concentrated in 18 high-conviction businesses. We added`,
    `two specialty manufacturers during the quarter and exited one consumer name.`,
    ``,
    `Fees for the quarter have been debited as per your fee schedule. Detailed`,
    `transaction and audit statements are available in the investor portal.`,
    ``,
    `Warm regards,`,
    `Investment Office, ${a.account.institution}`,
  ];
}

function npsPdfLines(a) {
  const total = a.holdings.reduce((s, h) => s + h.value, 0);
  return [
    `National Pension System — Statement of Transaction (synthetic eval fixture)`,
    `CRA: Synthetic Records Agency      PRAN: SYN-REDACTED      Tier: I`,
    `Statement as on 31-May-2026        Pension Fund: ${a.account.institution}`,
    ``,
    `Scheme                                       Units Held      NAV (Rs)     Holding Value (Rs)`,
    `--------------------------------------------------------------------------------------------`,
    ...a.holdings.map((h) =>
      `${h.name.padEnd(45)}${String(h.units).padEnd(16)}${h.nav.toFixed(2).padEnd(13)}${inGroup(h.value)}`),
    `--------------------------------------------------------------------------------------------`,
    `Total Tier I Holdings                                                     ${inGroup(total)}`,
    ``,
    `Contributions are invested per your active scheme preference (Auto/Active choice).`,
    `Units are allotted at the NAV of the investment day. NPS withdrawals are subject`,
    `to PFRDA exit regulations.`,
  ];
}

// ---- PNG screenshots via Chrome (skipped gracefully when Chrome is absent) --------------
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function statementHtml(title, sub, headers, rows, footer, inrStyle = true) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div id="stmt" style="width:860px;margin:18px;background:#fff;border:1px solid #d7dade;border-radius:8px;padding:22px 26px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <h2 style="margin:0;font-size:19px;color:#15314b">${title}</h2>
      <span style="font-size:11px;color:#69707a">${sub}</span>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:12.5px">
      <thead><tr>${headers.map((h, i) => `<th style="text-align:${i === 0 ? "left" : "right"};padding:7px 8px;border-bottom:2px solid #15314b;color:#15314b;font-size:11px">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i === 0 ? "left" : "right"};padding:7px 8px;border-bottom:1px solid #e5e8ec;${i === 0 ? "" : "font-variant-numeric:tabular-nums"}">${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
    <div style="margin-top:12px;text-align:right;font-weight:700;font-size:13.5px;color:#15314b">${footer}</div>
    <div style="margin-top:10px;font-size:10px;color:#8a9099">Synthetic eval fixture — not a real account. ${inrStyle ? "All values in ₹." : "All values in USD."}</div>
  </div></body>`;
}

async function renderPngs(targets) {
  const chrome = chromePath();
  if (!chrome) { console.log("  ⚠ Chrome not found — skipping PNG fixtures"); return []; }
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--no-sandbox"] });
  const written = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 920, height: 760, deviceScaleFactor: 2 });
    for (const t of targets) {
      await page.setContent(t.html, { waitUntil: "domcontentloaded" }); // no external resources
      const el = await page.$("#stmt");
      await el.screenshot({ path: join(OUT, t.file) });
      written.push(t.file);
    }
  } finally {
    await browser.close();
  }
  return written;
}

// ---- assemble ---------------------------------------------------------------------------

const truthOf = (a) => ({
  account: a.account,
  holdings: a.holdings.map((h) => ({ name: h.name, value: h.value, units: h.units, cost_basis: h.cost })),
  total: Math.round(a.holdings.reduce((s, h) => s + h.value, 0) * 100) / 100,
});

const manifest = [];
const add = (a, format, file, tier) => manifest.push({ id: `${a.id}.${format}`, archetype: a.id, format, file, tier, truth: truthOf(a) });

writeFileSync(join(OUT, "demat-equity.csv"), dematCsv(DEMAT));
add(DEMAT, "csv", "demat-equity.csv", "local");
writeFileSync(join(OUT, "bank-fd.csv"), fdCsv(FD));
add(FD, "csv", "bank-fd.csv", "local");
writeFileSync(join(OUT, "mf-statement.xlsx"), mfXlsx(MF));
add(MF, "xlsx", "mf-statement.xlsx", "local");
writeFileSync(join(OUT, "us-broker.xlsx"), usXlsx(US));
add(US, "xlsx", "us-broker.xlsx", "local");
writeFileSync(join(OUT, "mf-statement.pdf"), textPdf(mfPdfLines(MF)));
add(MF, "pdf", "mf-statement.pdf", "local");
writeFileSync(join(OUT, "bank-fd.pdf"), textPdf(fdPdfLines(FD)));
add(FD, "pdf", "bank-fd.pdf", "local");
writeFileSync(join(OUT, "pms-letter.pdf"), textPdf(pmsPdfLines(PMS)));
add(PMS, "pdf", "pms-letter.pdf", "local");
writeFileSync(join(OUT, "nps-statement.pdf"), textPdf(npsPdfLines(NPS)));
add(NPS, "pdf", "nps-statement.pdf", "local");

const pngTargets = [
  {
    file: "demat-equity.png",
    html: statementHtml(
      "Apex Securities — Holdings", "As on 31 May 2026 · Client SYN-CLIENT-42",
      ["Scrip", "Qty", "Avg Cost", "LTP", "Current Value", "P&L"],
      DEMAT.holdings.map((h) => [h.name, h.units, `₹${inGroup(h.cost / h.units)}`, `₹${inGroup(h.value / h.units)}`, `₹${inGroup(h.value)}`, `₹${inGroup(h.value - h.cost)}`]),
      `Portfolio Value: ₹${inGroup(DEMAT.holdings.reduce((s, h) => s + h.value, 0))}`,
    ),
  },
  {
    file: "us-broker.png",
    html: statementHtml(
      "Lakeshore Securities — Positions", "Account SYN...4427 · As of 05/30/2026",
      ["Security", "Shares", "Cost Basis", "Market Value", "Gain"],
      US.holdings.map((h) => [h.name, h.units, `$${usGroup(h.cost)}`, `$${usGroup(h.value)}`, `$${usGroup(h.value - h.cost)}`]),
      `Account Total: $${usGroup(US.holdings.reduce((s, h) => s + h.value, 0))}`,
      false,
    ),
  },
];

const pngs = await renderPngs(pngTargets);
if (pngs.includes("demat-equity.png")) add(DEMAT, "png", "demat-equity.png", "claude");
if (pngs.includes("us-broker.png")) add(US, "png", "us-broker.png", "claude");

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifest.length} fixtures to scripts/eval/fixtures/ (${pngs.length} PNG, ${manifest.length - pngs.length} text)`);
try {
  execSync("git status --short scripts/eval/fixtures | head -20", { cwd: ROOT, stdio: "inherit" });
} catch { /* git optional */ }
