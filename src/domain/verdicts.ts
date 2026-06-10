// Plain-words interpretations of the headline numbers. The audience is smart but has no
// finance vocabulary — a percentage with no verdict is just homework. These return ONE
// short sentence per metric, deliberately neutral-informative (a read, not advice).
//
// tone: "good" = comfortable · "ok" = nothing to flag · "watch" = worth a look.

export type Tone = "good" | "ok" | "watch";
export interface Verdict {
  tone: Tone;
  text: string;
}

// Share of assets in public equity — the growth/risk dial.
export function equityVerdict(pctOfAssets: number): Verdict {
  if (pctOfAssets < 20) return { tone: "ok", text: "On the safer side — little of it rides on the stock market." };
  if (pctOfAssets <= 60) return { tone: "good", text: "A balanced share of your money is in the stock market." };
  return { tone: "watch", text: "A large share of your money rides on the stock market." };
}

// Top-10 holdings as a share of assets — concentration in plain words.
export function concentrationVerdict(top10Pct: number): Verdict {
  if (top10Pct < 35) return { tone: "good", text: "Nicely spread out — no single bet dominates." };
  if (top10Pct <= 60) return { tone: "watch", text: "On the concentrated side — a few investments carry a lot." };
  return { tone: "watch", text: "Very concentrated — most of your money sits in a few investments." };
}

// Liquid share of assets — how reachable the money is.
export function liquidityVerdict(liquidPct: number): Verdict {
  if (liquidPct >= 25) return { tone: "good", text: "A healthy share could be turned into cash within days." };
  if (liquidPct >= 10) return { tone: "ok", text: "Some of it is reachable within days; much is locked in." };
  return { tone: "watch", text: "Most of it is locked away — hard to reach in a hurry." };
}
