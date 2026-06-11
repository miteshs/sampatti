// Local-extraction eval (docs/local-ai.md Phase 2): feed the TEXT of synthetic statements
// (scripts/eval/fixtures, exact ground truth in manifest.json) through the SAME inference
// path the app ships (src-tauri run_generate via examples/local_eval), with the SAME prompt
// the app builds, and score the result: holdings count, total value, per-holding name+value
// matches, per-field (units / cost basis) accuracy, tokens/s. Markdown + JSON report.
//
//   node scripts/eval/local-extract-eval.mjs                      # pinned model
//   node scripts/eval/local-extract-eval.mjs --model /path/x.gguf --label qwen3-8b
//   node scripts/eval/local-extract-eval.mjs --analysis           # add the quick-take probe
//   node scripts/eval/local-extract-eval.mjs --only mf-statement.pdf
//
// No network anywhere in this harness — the model file must already be on disk.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, homedir } from "node:os";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(ROOT, "scripts", "eval", "fixtures");
const BIN = join(ROOT, "src-tauri", "target", "release", "examples", "local_eval");

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const MODEL = argOf("--model")
  ?? join(homedir(), "Library", "Application Support", "app.sampatti.desktop", "models", "Qwen3-4B-Q4_K_M.gguf");
const LABEL = argOf("--label") ?? basename(MODEL).replace(/\.gguf$/i, "").toLowerCase();
const ONLY = argOf("--only");
const DO_ANALYSIS = args.includes("--analysis");

if (!existsSync(BIN)) {
  console.error(`eval binary missing — build it first:\n  cd src-tauri && cargo build --release --example local_eval`);
  process.exit(2);
}
if (!existsSync(MODEL)) {
  console.error(`model not found at ${MODEL} — download it (Privacy screen, or pass --model)`);
  process.exit(2);
}

// ---- the app's exact prompt, read from source so there is ONE source of truth -----------
const aiExtractSrc = readFileSync(join(ROOT, "src", "ingest", "aiExtract.ts"), "utf8");
const promptMatch = aiExtractSrc.match(/const PROMPT = `([\s\S]*?)`;\n/);
if (!promptMatch) {
  console.error("could not locate PROMPT in src/ingest/aiExtract.ts");
  process.exit(2);
}
const PROMPT = promptMatch[1];

// ---- statement text per format (mirrors the app's ingest text paths) --------------------

async function pdfLines(path) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // Group items into lines by their y coordinate (like the app's pdfToLines).
    const rows = new Map();
    for (const it of tc.items) {
      if (!("transform" in it)) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const line = rows.get(y).sort((a, b) => a.x - b.x).map((r) => r.s).join(" ").trimEnd();
      if (line.trim()) out.push(line);
    }
  }
  return out.join("\n");
}

function xlsxText(path) {
  const wb = XLSX.readFile(path);
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
}

async function statementText(fixture) {
  const path = join(FIX, fixture.file);
  if (fixture.format === "csv") return readFileSync(path, "utf8");
  if (fixture.format === "xlsx") return xlsxText(path);
  if (fixture.format === "pdf") return pdfLines(path);
  throw new Error(`no text path for format ${fixture.format}`);
}

// ---- JSON repair (port of aiExtract.extractJson, for truncated outputs) -----------------
function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?|```$/gm, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error(`no JSON object in output: ${cleaned.slice(0, 120)}`);
  const frag = cleaned.slice(start);
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < frag.length; i++) {
    const ch = frag[i];
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
      if (stack.length === 0) return { value: JSON.parse(frag.slice(0, i + 1)), repaired: false };
    }
  }
  let repair = frag.replace(/[\s,]+$/, "");
  if (inStr) repair += '"';
  repair += [...stack].reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  return { value: JSON.parse(repair), repaired: true };
}

// ---- scoring ------------------------------------------------------------------------------
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/[₹$,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const normName = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => new Set(normName(s).split(" ").filter((t) => t.length > 2));
function nameSim(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size); // containment — statements truncate names
}
const relErr = (got, want) => (want === 0 ? (got === 0 ? 0 : 1) : Math.abs(got - want) / Math.abs(want));

function score(raw, truth) {
  const obj = raw ?? {};
  const accounts = Array.isArray(obj.accounts) && obj.accounts.length ? obj.accounts : [obj];
  const holdings = accounts.flatMap((a) => (Array.isArray(a?.holdings) ? a.holdings : []));
  const got = holdings
    .map((h) => ({ name: h?.name ?? h?.symbol ?? "", value: num(h?.value ?? h?.market_value), units: num(h?.units), cost: num(h?.cost_basis) }))
    .filter((h) => h.value !== undefined);

  const used = new Set();
  let matched = 0, valueOff = 0, unitsRight = 0, unitsSeen = 0, costRight = 0, costSeen = 0;
  for (const t of truth.holdings) {
    let best = -1, bestSim = 0.49; // demand a majority-token name match
    for (let i = 0; i < got.length; i++) {
      if (used.has(i)) continue;
      const sim = nameSim(got[i].name, t.name);
      if (sim > bestSim) { bestSim = sim; best = i; }
    }
    if (best < 0) continue;
    used.add(best);
    const g = got[best];
    if (relErr(g.value, t.value) <= 0.01) matched++;
    else valueOff++;
    if (t.units !== undefined) {
      unitsSeen++;
      if (g.units !== undefined && relErr(g.units, t.units) <= 0.01) unitsRight++;
    }
    if (t.cost_basis !== undefined) {
      costSeen++;
      if (g.cost !== undefined && relErr(g.cost, t.cost_basis) <= 0.01) costRight++;
    }
  }
  const gotTotal = got.reduce((s, h) => s + (h.value ?? 0), 0);
  const acct = accounts[0] ?? {};
  return {
    holdingsGot: got.length,
    holdingsWant: truth.holdings.length,
    matched,
    valueOff,
    missing: truth.holdings.length - matched - valueOff,
    hallucinated: Math.max(0, got.length - matched - valueOff),
    totalRelErr: relErr(gotTotal, truth.total),
    currencyOk: String(acct.currency ?? "").toUpperCase() === truth.account.currency,
    typeOk: String(acct.account_type ?? "") === truth.account.account_type,
    units: unitsSeen ? `${unitsRight}/${unitsSeen}` : "—",
    cost: costSeen ? `${costRight}/${costSeen}` : "—",
  };
}

// ---- run ----------------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(FIX, "manifest.json"), "utf8"));
const textFixtures = manifest.filter((f) => f.tier === "local" && (!ONLY || f.file === ONLY || f.id === ONLY));
const tmp = mkdtempSync(join(tmpdir(), "sampatti-eval-"));

console.log(`model: ${MODEL}\nlabel: ${LABEL}\nfixtures: ${textFixtures.length} text (PNG/image fixtures are Claude-tier by design — not local-evaled)\n`);

const rows = [];
for (const f of textFixtures) {
  const text = await statementText(f);
  if (text.length > 6000) console.warn(`  ⚠ ${f.id}: text ${text.length} chars exceeds the no-focus threshold; app would apply focus()`);
  const promptFile = join(tmp, `${f.id}.prompt.txt`);
  writeFileSync(promptFile, `${PROMPT}\n\n--- STATEMENT TEXT ---\n${text.slice(0, 24000)}`);

  process.stdout.write(`▶ ${f.id} … `);
  const t0 = Date.now();
  const run = spawnSync(BIN, [MODEL, promptFile, "json", "4000"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const secs = (Date.now() - t0) / 1000;
  if (run.status !== 0) {
    console.log(`FAILED (${run.stderr?.trim().slice(0, 200)})`);
    rows.push({ id: f.id, error: run.stderr?.trim().slice(0, 300) ?? "non-zero exit", secs });
    continue;
  }
  const tokPerS = run.stderr?.match(/\(([\d.]+) tok\/s\)/)?.[1];
  let parsed;
  try {
    parsed = extractJson(run.stdout);
  } catch (e) {
    console.log(`JSON FAILED (${e.message.slice(0, 120)})`);
    rows.push({ id: f.id, error: `unparseable JSON: ${e.message.slice(0, 200)}`, secs, tokPerS });
    continue;
  }
  const s = score(parsed.value, f.truth);
  rows.push({ id: f.id, ...s, repaired: parsed.repaired, secs, tokPerS, raw: parsed.value });
  console.log(
    `${s.matched}/${s.holdingsWant} matched, total Δ ${(s.totalRelErr * 100).toFixed(2)}%, ${secs.toFixed(0)}s @ ${tokPerS ?? "?"} tok/s${parsed.repaired ? " (JSON repaired)" : ""}`,
  );
}

// ---- optional: on-device "quick take" analysis probe ---------------------------------------
let analysisNote = "";
if (DO_ANALYSIS) {
  // A representative deterministic brief (shape of buildBrief output, synthetic numbers).
  const brief = {
    asOf: "2026-06-11", baseCurrency: "INR", netWorth: 24500000, totalAssets: 27000000,
    totalLiabilities: 2500000, liquidAssets: 9800000, liquidPct: 36,
    allocationByClass: [
      { label: "Indian equity", value: 8200000, percent: 30 },
      { label: "Equity MF", value: 6400000, percent: 24 },
      { label: "Real estate", value: 7000000, percent: 26 },
      { label: "EPF/PPF", value: 3300000, percent: 12 },
      { label: "Gold", value: 2100000, percent: 8 },
    ],
    concentration: { largestPctOfLiquid: 22, top5PctOfLiquid: 61, hhi: 1240, topHoldings: [
      { name: "Reliance Industries", pctOfAssets: 8, account: "Demat" },
      { name: "HDFC Bank", pctOfAssets: 6, account: "Demat" },
    ] },
    taxWrappers: { taxable: 18200000, exemptEEE: 3300000, nps: 0 },
    gains: { totalCostBasis: 15600000, unrealizedGain: 5200000, unrealizedPct: 33 },
  };
  const prompt = [
    "You are a careful Indian financial analyst. Write a short, plain-words review (5 bullet points max) of this portfolio brief for its owner.",
    JSON.stringify(brief, null, 2),
    "Note: you are the on-device quick-take model. Use ONLY the numbers present in the brief above — never invent figures or tax rules. Keep it short and plain.",
  ].join("\n\n");
  const pf = join(tmp, "analysis.prompt.txt");
  writeFileSync(pf, prompt);
  process.stdout.write(`▶ analysis quick-take … `);
  const t0 = Date.now();
  const run = spawnSync(BIN, [MODEL, pf, "text", "700"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const secs = (Date.now() - t0) / 1000;
  if (run.status !== 0) {
    analysisNote = `quick-take probe FAILED: ${run.stderr?.trim().slice(0, 200)}`;
    console.log("FAILED");
  } else {
    const out = run.stdout.trim();
    // Soft invention check: every ₹-scale figure in the output should trace to the brief
    // (allowing lakh/crore re-expressions of brief numbers).
    const briefNums = new Set();
    for (const m of JSON.stringify(brief).matchAll(/\d+(?:\.\d+)?/g)) {
      const v = Number(m[0]);
      briefNums.add(v);
      if (v >= 100000) { briefNums.add(v / 100000); briefNums.add(v / 10000000); } // lakh / crore
      if (v >= 1000) briefNums.add(v / 1000);
    }
    const suspects = [];
    for (const m of out.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const v = Number(m[0].replace(/,/g, ""));
      if (!Number.isFinite(v) || v < 1000) continue; // small numbers = counts/percent math
      const ok = [...briefNums].some((b) => b !== 0 && Math.abs(v - b) / b <= 0.02);
      if (!ok) suspects.push(m[0]);
    }
    const tokPerS = run.stderr?.match(/\(([\d.]+) tok\/s\)/)?.[1];
    analysisNote = [
      `quick-take: ${out.split(/\s+/).length} words in ${secs.toFixed(0)}s @ ${tokPerS ?? "?"} tok/s; ` +
      `${suspects.length === 0 ? "NO invented ₹-scale figures detected" : `possible invented figures: ${[...new Set(suspects)].slice(0, 6).join(", ")}`}`,
      "", "```", out.slice(0, 1800), "```",
    ].join("\n");
    console.log(`${secs.toFixed(0)}s, ${suspects.length} suspect figure(s)`);
  }
}

// ---- report -------------------------------------------------------------------------------
const ok = rows.filter((r) => !r.error);
const summary = {
  model: basename(MODEL), label: LABEL, date: new Date().toISOString().slice(0, 10),
  fixtures: rows.length,
  failures: rows.length - ok.length,
  holdingsMatched: ok.reduce((s, r) => s + r.matched, 0),
  holdingsTotal: ok.reduce((s, r) => s + r.holdingsWant, 0),
  totalsWithin1pct: ok.filter((r) => r.totalRelErr <= 0.01).length,
  currencyOk: ok.filter((r) => r.currencyOk).length,
  medianTokPerS: ok.map((r) => Number(r.tokPerS)).filter(Boolean).sort((a, b) => a - b)[Math.floor(ok.length / 2)] ?? null,
};

const md = [
  `# Local extraction eval — ${LABEL}`,
  ``,
  `${summary.date} · model \`${summary.model}\` · ${rows.length} text fixtures (synthetic, scripts/eval/fixtures)`,
  ``,
  `**Headline: ${summary.holdingsMatched}/${summary.holdingsTotal} holdings matched (name + value ≤1%), ` +
  `${summary.totalsWithin1pct}/${ok.length} statement totals within 1%, ` +
  `${summary.currencyOk}/${ok.length} currencies right, median ${summary.medianTokPerS ?? "?"} tok/s.**`,
  ``,
  `| fixture | holdings (got/want) | matched | value-off | missing | extra | total Δ% | ccy | type | units | cost | time | tok/s |`,
  `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) =>
    r.error
      ? `| ${r.id} | — | — | — | — | — | — | — | — | — | — | ${r.secs?.toFixed(0) ?? "?"}s | ERROR: ${r.error.slice(0, 80)} |`
      : `| ${r.id} | ${r.holdingsGot}/${r.holdingsWant} | ${r.matched} | ${r.valueOff} | ${r.missing} | ${r.hallucinated} | ${(r.totalRelErr * 100).toFixed(2)} | ${r.currencyOk ? "✓" : "✗"} | ${r.typeOk ? "✓" : "✗"} | ${r.units} | ${r.cost} | ${r.secs.toFixed(0)}s | ${r.tokPerS ?? "?"}${r.repaired ? " (repaired)" : ""} |`),
  ``,
  `- matched = name-matched holding with value within 1% of truth; value-off = right holding, wrong value`,
  `- extra = model holdings that match no ground-truth row (hallucination risk)`,
  `- every extraction lands in the review card — the floor is "annoying", never "silently wrong"`,
  ...(analysisNote ? ["", "## On-device quick-take probe", "", analysisNote] : []),
].join("\n");

const reportPath = join(ROOT, "scripts", "eval", `report-${LABEL}.md`);
writeFileSync(reportPath, md);
writeFileSync(join(ROOT, "scripts", "eval", `results-${LABEL}.json`), JSON.stringify(rows.map(({ raw, ...r }) => r), null, 2));
console.log(`\n${md.split("\n").slice(0, 8).join("\n")}\n\nreport → ${reportPath}`);
