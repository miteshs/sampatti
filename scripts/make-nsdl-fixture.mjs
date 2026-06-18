// Generate a realistic-looking NSDL e-CAS PDF from the SAME synthetic line fixture the parser
// test uses (src/ingest/__fixtures__/nsdlCasComplex.json) — so dragging the PDF into the app
// exercises the full pdf.js → depositoryCas → import-review path end-to-end (holders, the Joint
// badge, AIF split). Text-layer PDF (page.pdf), so it parses without OCR. Fully fabricated data.
//
//   node scripts/make-nsdl-fixture.mjs   →   test-fixtures/nsdl-cas-complex.pdf
//
// Reuses the Chrome resolution from scripts/landing/shots.mjs.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const c of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser",
  ]) if (existsSync(c)) return c;
  throw new Error("Chrome not found — set CHROME_PATH");
}

const lines = JSON.parse(readFileSync(join(ROOT, "src/ingest/__fixtures__/nsdlCasComplex.json"), "utf8"));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isIsinRow = (l) => /\bIN[EF][A-Z0-9]{9}\b/.test(l);
const isSection = (l) => /^(ACCOUNT\(S\) HELD WITH|ALTERNATIVE INVESTMENT FUNDS|MUTUAL FUND FOLIOS)/i.test(l);
const isDp = (l) => /^DP Name:/i.test(l);
const isHolder = (l) => /holder/i.test(l) && /:/.test(l);
const isFolio = (l) => /^Folio No:/i.test(l);
const isTotal = (l) => /^(Sub Total|Grand Total)/i.test(l);

function cls(l) {
  if (isSection(l)) return "section";
  if (isDp(l)) return "dp";
  if (isHolder(l)) return "holder";
  if (isFolio(l)) return "folio";
  if (isTotal(l)) return "total";
  if (isIsinRow(l)) return "row";
  if (/^(Consolidated Account Statement|Statement for the period)/i.test(l)) return "title";
  return "meta";
}

const body = lines.map((l) => `<div class="line ${cls(l)}">${esc(l)}</div>`).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; font-size: 9.5px; line-height: 1.5; }
  .doc-head { border-bottom: 2px solid #14326e; padding-bottom: 6px; margin-bottom: 8px; }
  .doc-head .org { color: #14326e; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; }
  .doc-head .sub { color: #555; font-size: 8px; }
  .line { white-space: pre-wrap; }
  .title { font-weight: 600; color: #14326e; }
  .section { margin-top: 12px; background: #eef2fb; border-left: 3px solid #14326e; padding: 3px 6px; font-weight: 700; color: #14326e; text-transform: uppercase; letter-spacing: 0.03em; }
  .dp { margin-top: 8px; font-weight: 700; }
  .holder { color: #444; font-style: italic; }
  .folio { margin-top: 6px; color: #333; font-weight: 600; }
  .row { font-family: "Menlo", "Courier New", monospace; font-size: 9px; border-bottom: 1px dotted #ddd; padding: 1px 0; }
  .total { font-weight: 700; color: #14326e; }
  .meta { color: #666; }
</style></head><body>
  <div class="doc-head">
    <div class="org">NSDL — National Securities Depository Limited</div>
    <div class="sub">Consolidated Account Statement · SYNTHETIC TEST DATA — not a real statement</div>
  </div>
  ${body}
</body></html>`;

const outDir = join(ROOT, "test-fixtures");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const out = join(outDir, "nsdl-cas-complex.pdf");

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({ path: out, format: "A4", printBackground: true });
  console.log(`✓ wrote ${out} (${lines.length} statement lines)`);
} finally {
  await browser.close();
}
