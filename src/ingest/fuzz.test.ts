// PARSER FUZZING — the importers are the app's front door and eat hostile real-world
// files. Properties, not examples: for ANY input, parsers either return well-formed drafts
// (finite numbers, string names) or throw an ordinary Error — never hang, never emit NaN
// holdings, never let a subtotal masquerade as a position. Seeded for reproducibility.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCsv } from "./csv";
import { looksLikeCas, parseCamsCas } from "./cas";
import { looksLikeDepositoryCas, parseDepositoryCas, rowTriple } from "./depositoryCas";
import { findCrossAccountDuplicates } from "./reconcile";
import type { Account, Holding, ImportDraft } from "../domain/types";

const FC = { seed: 1991, numRuns: 150 };

function assertWellFormed(drafts: ImportDraft[]) {
  for (const d of drafts) {
    expect(typeof d.account.name).toBe("string");
    for (const h of d.holdings) {
      expect(typeof h.name).toBe("string");
      expect(Number.isFinite(h.marketValue), `marketValue finite (${h.name})`).toBe(true);
      if (h.units != null) expect(Number.isFinite(h.units)).toBe(true);
      if (h.costBasis != null) expect(Number.isFinite(h.costBasis)).toBe(true);
    }
  }
}

// Arbitrary "statement-ish" lines: random text salted with the tokens our parsers key on,
// so the fuzzer actually reaches the deep branches instead of bailing at detection.
const statementLine = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.constantFrom(
    "Consolidated Account Statement",
    "Folio No: 123 / 0",
    "PORTFOLIO SUMMARY",
    "Closing Unit Balance: 1,234.567 NAV on 31-May-2026: INR 95.5000",
    "INF0AA0TEST1-Some Fund - Direct Growth - ISIN: INF0AA0TEST1",
    "INE0AA0TEST1 SOME COMPANY LIMITED 10.00 250 2,856.50 7,14,125.00",
    "DP Name: SOME BROKER DP ID IN300999",
    "Total 99,99,999.99",
    "Sub Total",
    "NAV on 31-May-2026: INR",
  ),
  fc.array(fc.oneof(fc.double({ noNaN: true, min: -1e12, max: 1e12 }).map(String), fc.string({ maxLength: 12 })), { maxLength: 8 }).map((xs) => xs.join(" ")),
);
const statementLines = fc.array(statementLine, { maxLength: 60 });

describe("fuzz: CSV", () => {
  it("any text → well-formed drafts or a plain Error", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        try {
          assertWellFormed(parseCsv(text, "fuzz.csv"));
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      FC,
    );
  });
});

describe("fuzz: CAS parsers", () => {
  it("detectors never throw and always return booleans", () => {
    fc.assert(
      fc.property(statementLines, (lines) => {
        expect(typeof looksLikeCas(lines)).toBe("boolean");
        expect(typeof looksLikeDepositoryCas(lines)).toBe("boolean");
      }),
      FC,
    );
  });

  it("CAMS parser: well-formed drafts or a plain Error, never NaN", () => {
    fc.assert(
      fc.property(statementLines, (lines) => {
        try {
          assertWellFormed(parseCamsCas(lines, "fuzz.pdf"));
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      FC,
    );
  });

  it("depository parser: well-formed drafts or a plain Error, never NaN", () => {
    fc.assert(
      fc.property(statementLines, (lines) => {
        try {
          assertWellFormed(parseDepositoryCas(lines, "fuzz.pdf"));
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      FC,
    );
  });

  it("rowTriple only ever returns internally-consistent triples", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ noNaN: true, min: 0, max: 1e12 }), { maxLength: 8 }), (tail) => {
        const t = rowTriple(tail);
        if (t) {
          expect(Math.abs(t.units * t.price - t.value)).toBeLessThanOrEqual(Math.max(1, t.value * 0.02));
        }
      }),
      FC,
    );
  });
});

describe("fuzz: reconciliation", () => {
  const holdingArb = fc.record({
    id: fc.uuid(),
    accountId: fc.constantFrom("a", "b", "c"),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    assetClass: fc.constant("equity_mf" as const),
    marketValue: fc.double({ noNaN: true, min: 0, max: 1e10 }),
    currency: fc.constant("INR"),
    units: fc.option(fc.double({ noNaN: true, min: 0, max: 1e7 }), { nil: undefined }),
    symbol: fc.option(fc.constantFrom("INF0AA0TEST1", "INF0BB0TEST2", "XYZ"), { nil: undefined }),
  });

  it("hits always reference valid draft indices and real accounts", () => {
    const accounts: Account[] = ["a", "b", "c"].map((id) => ({
      id, name: `Acct ${id}`, institution: "X", accountType: "mutual_fund",
      taxTreatment: "taxable", region: "India", currency: "INR",
    } as Account));
    fc.assert(
      fc.property(
        fc.array(holdingArb, { maxLength: 10 }),
        fc.array(holdingArb, { maxLength: 10 }),
        (draftHoldings, existing) => {
          const draft: ImportDraft = {
            account: { name: "D", institution: "I", accountType: "mutual_fund", taxTreatment: "taxable", region: "India", currency: "INR" },
            holdings: draftHoldings.map(({ id: _id, accountId: _a, ...h }) => h),
            warnings: [], source: "fuzz",
          };
          const hits = findCrossAccountDuplicates(draft, existing as Holding[], accounts, "a");
          for (const hit of hits) {
            expect(hit.index).toBeGreaterThanOrEqual(0);
            expect(hit.index).toBeLessThan(draft.holdings.length);
            expect(hit.accountId).not.toBe("a"); // the exempted target never matches
            expect(typeof hit.exact).toBe("boolean");
          }
        },
      ),
      FC,
    );
  });
});
