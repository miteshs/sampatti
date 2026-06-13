// Deterministic retirement / goal projection — the on-device numbers behind the (optional)
// "Retirement outlook" card. Compounds the current corpus + ongoing monthly contributions to
// the retirement year, then compares against the corpus needed to fund a desired income using
// a safe-withdrawal rate (the "25× rule" at 4%). India-typical defaults (10% nominal return,
// 6% inflation) live in the UI. Pure + framework-free; the AI narrative (if any) reads these
// numbers, it never invents them.

import type { Tone } from "./verdicts";

export interface RetirementInputs {
  currentAge: number;
  retireAge: number;
  currentCorpus: number; // investable corpus today, base currency
  monthlyContribution: number; // invested per month, base currency
  expectedReturnPct: number; // nominal annual %, e.g. 10
  inflationPct: number; // annual %, e.g. 6
  desiredMonthlyIncome: number; // in TODAY's money, base currency
  withdrawalRatePct?: number; // safe withdrawal rate; default 4 (the 25× rule)
}

export interface RetirementProjection {
  years: number;
  projectedCorpus: number; // nominal, at the retirement year
  requiredCorpus: number; // nominal corpus needed to fund the desired income
  gap: number; // projectedCorpus − requiredCorpus (≥0 = on track / surplus)
  coverageRatio: number; // projected / required (1 = exactly on track)
  desiredAnnualIncomeAtRetirement: number; // desired income inflated to the retirement year
  tone: Tone;
  headline: string;
}

const clampPct = (x: number) => (Number.isFinite(x) ? Math.max(0, x) : 0);

export function projectRetirement(input: RetirementInputs): RetirementProjection {
  const years = Math.max(0, Math.floor(input.retireAge - input.currentAge));
  const r = clampPct(input.expectedReturnPct) / 100;
  const infl = clampPct(input.inflationPct) / 100;
  const swr = clampPct(input.withdrawalRatePct ?? 4) / 100 || 0.04;
  const corpus = Math.max(0, input.currentCorpus || 0);
  const monthly = Math.max(0, input.monthlyContribution || 0);

  // Future value of today's corpus.
  const fvCorpus = corpus * Math.pow(1 + r, years);
  // Future value of monthly contributions (ordinary annuity, monthly compounding).
  const i = r / 12;
  const months = years * 12;
  const fvContrib = i === 0 ? monthly * months : monthly * ((Math.pow(1 + i, months) - 1) / i);
  const projectedCorpus = fvCorpus + fvContrib;

  // Corpus needed: desired income (inflated to retirement) funded at the safe-withdrawal rate.
  const desiredAnnualIncomeAtRetirement = Math.max(0, input.desiredMonthlyIncome || 0) * 12 * Math.pow(1 + infl, years);
  const requiredCorpus = desiredAnnualIncomeAtRetirement / swr;

  const gap = projectedCorpus - requiredCorpus;
  const coverageRatio = requiredCorpus > 0 ? projectedCorpus / requiredCorpus : Infinity;

  let tone: Tone;
  let headline: string;
  if (coverageRatio >= 1) {
    tone = "good";
    headline = coverageRatio >= 1.15 ? "On track with room to spare." : "On track for the income you want.";
  } else if (coverageRatio >= 0.8) {
    tone = "ok";
    headline = "Close — a little more saving or time would close the gap.";
  } else {
    tone = "watch";
    headline = "Short of the goal at this pace — worth revisiting saving or timing.";
  }

  return { years, projectedCorpus, requiredCorpus, gap, coverageRatio, desiredAnnualIncomeAtRetirement, tone, headline };
}
