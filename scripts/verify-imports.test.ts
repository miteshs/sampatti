// @vitest-environment node
//
// Import-coverage harness. Two jobs:
//   1. Asserts the committed example fixtures (scripts/fixtures/) still parse — a regression
//      check on the brokers we claim to support.
//   2. Reports on any REAL exports you drop into ../samples (gitignored, parsed locally so
//      nothing leaves your machine), so you can eyeball accuracy against the statement.
//
// Run just this:  npm run verify:imports
// Drop files in:  sampatti/samples/   (CSV / Excel; PDFs & images go through Claude)

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/ingest/csv";
import { parseXlsx } from "../src/ingest/xlsx";
import type { ImportDraft } from "../src/domain/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const SAMPLES = join(HERE, "..", "samples");

function parseFile(path: string, name: string): ImportDraft[] {
  if (/\.csv$/i.test(name)) return parseCsv(readFileSync(path, "utf8"), name);
  const buf = readFileSync(path);
  return [...parseXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name)];
}

function report(dir: string): string[] {
  const files = readdirSync(dir).filter((f) => /\.(csv|xlsx|xls)$/i.test(f)).sort();
  return files.map((f) => {
    try {
      const drafts = parseFile(join(dir, f), f);
      const holdings = drafts.flatMap((d) => d.holdings);
      if (holdings.length === 0) return `  ⚠  ${f.padEnd(40)} → "Parse with Claude" (0 holdings recognized locally)`;
      const ccy = [...new Set(holdings.map((h) => h.currency))];
      const totals = ccy.map((c) => `${c} ${holdings.filter((h) => h.currency === c).reduce((s, h) => s + h.marketValue, 0).toLocaleString("en-IN")}`);
      const warn = drafts.flatMap((d) => d.warnings).length;
      return `  ✓  ${f.padEnd(40)} ${holdings.length} holdings · ${drafts.length} acct · ${totals.join(", ")}${warn ? ` · ${warn} warning(s)` : ""}`;
    } catch (e) {
      return `  ✗  ${f.padEnd(40)} ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  });
}

describe("import coverage", () => {
  it("every committed broker fixture parses locally with holdings", () => {
    const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /\.(csv|xlsx|xls)$/i.test(f)) : [];
    console.log(`\nBroker format fixtures (scripts/fixtures/) — ${files.length} file(s):\n` + report(FIXTURES).join("\n") + "\n");
    for (const f of files) {
      const drafts = parseFile(join(FIXTURES, f), f);
      expect(drafts.flatMap((d) => d.holdings).length, `${f} should parse to >0 holdings`).toBeGreaterThan(0);
    }
  });

  it("reports on your real exports in samples/ (no assertions — eyeball the output)", () => {
    if (!existsSync(SAMPLES)) mkdirSync(SAMPLES, { recursive: true });
    const files = readdirSync(SAMPLES).filter((f) => /\.(csv|xlsx|xls)$/i.test(f));
    if (files.length === 0) {
      console.log("  samples/ is empty — drop real broker CSV/Excel exports there and re-run `npm run verify:imports`.\n  (Parsing is local; nothing is uploaded. The folder is gitignored.)\n");
      return;
    }
    console.log(`\nYour real exports (samples/) — ${files.length} file(s), parsed locally:\n` + report(SAMPLES).join("\n") +
      "\n\n  ✓ parsed locally   ⚠ would use the Claude fallback   ✗ crashed\n  Compare each ✓ row's totals/currency against the actual statement.\n");
  });
});

// Real CAS check: drop your CAS PDF into samples/cas/ (gitignored) with its password in
// samples/cas/password.txt, and this verifies the LOCAL parser reads it end-to-end —
// nothing leaves the machine. Uses pdf.js's node (legacy) build; skips cleanly when absent.
describe("real CAS in samples/cas (optional, local-only)", () => {
  const casDir = join(SAMPLES, "cas");
  const pdfs = existsSync(casDir) ? readdirSync(casDir).filter((f) => /\.pdf$/i.test(f)) : [];
  it.skipIf(pdfs.length === 0)("parses the CAS locally with holdings and costs", async () => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { looksLikeCas, parseCamsCas } = await import("../src/ingest/cas");
    const pwFile = join(casDir, "password.txt");
    const password = existsSync(pwFile) ? readFileSync(pwFile, "utf8").trim() : undefined;
    for (const f of pdfs) {
      const buf = readFileSync(join(casDir, f));
      const doc = await getDocument({ data: new Uint8Array(buf), password }).promise;
      const lines: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const runs = content.items
          .filter((it: unknown): it is { str: string; transform: number[] } =>
            typeof it === "object" && it !== null && "str" in it && !!(it as { str: string }).str.trim())
          .map((it) => ({ text: it.str, x: it.transform[4], y: it.transform[5] }))
          .sort((a, b) => b.y - a.y || a.x - b.x);
        let cur: { y: number; parts: { x: number; text: string }[] } | null = null;
        const flush = () => { if (cur) { cur.parts.sort((a, b) => a.x - b.x); lines.push(cur.parts.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim()); cur = null; } };
        for (const r of runs) {
          if (!cur || Math.abs(cur.y - r.y) > 2.5) { flush(); cur = { y: r.y, parts: [{ x: r.x, text: r.text }] }; }
          else cur.parts.push({ x: r.x, text: r.text });
        }
        flush();
      }
      expect(looksLikeCas(lines), `${f} should be detected as a CAS`).toBe(true);
      const [draft] = parseCamsCas(lines, f);
      const withCost = draft.holdings.filter((h) => h.costBasis != null).length;
      console.log(`  ✓  ${f}: ${draft.holdings.length} schemes · ${withCost} with cost · asOf ${draft.account.asOf ?? "—"}${draft.warnings.length ? ` · ${draft.warnings.join(" / ")}` : ""}`);
      expect(draft.holdings.length).toBeGreaterThan(0);
    }
  });
});
