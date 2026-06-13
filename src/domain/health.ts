// A single "portfolio health" read (0–100) — the one-glance answer to "how am I doing?"
// for someone who won't read three separate verdicts. It is built from EXACTLY the same
// verdicts the Overview shows beneath it (equity exposure, concentration, liquidity), so the
// headline score can never disagree with the plain-words sublines. Deterministic, on-device,
// and a *read* — not advice (same stance as verdicts.ts).
//
// Scoring: each component's verdict tone maps to points (good=100, ok=72, watch=45), then a
// weighted average — concentration weighed heaviest because it's the failure mode that most
// often hurts an otherwise-fine portfolio. Tone-based (not raw-metric) keeps it transparent
// and identical to the sublines; a continuous within-band curve is a possible future refinement.

import type { Tone } from "./verdicts";
import { concentrationVerdict, equityVerdict, liquidityVerdict } from "./verdicts";

export interface HealthComponent {
  label: string;
  tone: Tone;
  weight: number;
}

export interface HealthBand {
  key: "strong" | "healthy" | "building" | "attention";
  label: string;
  tone: Tone;
}

export interface PortfolioHealth {
  score: number; // 0–100, rounded
  band: HealthBand;
  components: HealthComponent[];
}

const TONE_POINTS: Record<Tone, number> = { good: 100, ok: 72, watch: 45 };

export interface HealthInput {
  equityPct: number; // public-equity share of assets
  top10Pct: number; // top-10 holdings as a share of assets (concentration)
  liquidPct: number; // liquid share of assets
}

export function portfolioHealth(input: HealthInput): PortfolioHealth {
  const components: HealthComponent[] = [
    { label: "Stock-market exposure", tone: equityVerdict(input.equityPct).tone, weight: 0.3 },
    { label: "Concentration", tone: concentrationVerdict(input.top10Pct).tone, weight: 0.4 },
    { label: "Liquidity", tone: liquidityVerdict(input.liquidPct).tone, weight: 0.3 },
  ];
  const score = Math.round(components.reduce((sum, c) => sum + TONE_POINTS[c.tone] * c.weight, 0));
  return { score, band: bandFor(score), components };
}

// Calm, editorial bands (not a gamified "athlete" metaphor — Sampatti's audience is older and
// the tone is reassuring, not competitive).
export function bandFor(score: number): HealthBand {
  if (score >= 85) return { key: "strong", label: "In great shape", tone: "good" };
  if (score >= 70) return { key: "healthy", label: "Healthy", tone: "good" };
  if (score >= 55) return { key: "building", label: "Coming along", tone: "ok" };
  return { key: "attention", label: "Worth a look", tone: "watch" };
}
