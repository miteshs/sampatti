// The region seam (docs/regions.md): one app, two markets. Everything market-specific —
// base currency, money formatting, persona country, labels — hangs off ONE profile object.
// Components ask the profile; they never branch on settings.country themselves. prompts.ts
// holds the only allowed country branch (personas are inherently per-market prose).

import { inr } from "../domain/format";
import { useStore } from "../storage/store";

export type Region = "IN" | "US";

export interface RegionProfile {
  region: Region;
  /** The Settings.country value this profile answers to (stored human-readable for compat). */
  country: "India" | "US";
  label: string;
  baseCurrency: "INR" | "USD";
  symbol: string;
  /** Market-native money rendering: ₹ lakh/crore for IN, $ K/M/B for US. */
  formatMoney(value: number, opts?: { compact?: boolean }): string;
  /** Who the analysis persona is, for UI copy ("not a substitute for…"). */
  adviserNoun: string;
}

// $ with K/M/B compaction, mirroring inr()'s shape: sign out front, two decimals when
// compacted, plain en-US grouping for small amounts or compact:false.
function usd(value: number, opts: { compact?: boolean } = {}): string {
  const neg = value < 0;
  const a = Math.abs(value);
  let body: string;
  if (opts.compact === false) {
    body = "$" + Math.round(a).toLocaleString("en-US");
  } else if (a >= 1e9) {
    body = `$${(a / 1e9).toFixed(2)}B`;
  } else if (a >= 1e6) {
    body = `$${(a / 1e6).toFixed(2)}M`;
  } else if (a >= 1e4) {
    body = `$${(a / 1e3).toFixed(1)}K`;
  } else {
    body = "$" + Math.round(a).toLocaleString("en-US");
  }
  return neg ? "−" + body : body;
}

export const PROFILES: Record<Region, RegionProfile> = {
  IN: {
    region: "IN",
    country: "India",
    label: "India",
    baseCurrency: "INR",
    symbol: "₹",
    formatMoney: (v, opts) => inr(v, opts),
    adviserNoun: "SEBI-registered adviser",
  },
  US: {
    region: "US",
    country: "US",
    label: "United States",
    baseCurrency: "USD",
    symbol: "$",
    formatMoney: usd,
    adviserNoun: "fiduciary adviser (RIA/CFP)",
  },
};

/** Map stored settings to a region; anything unrecognized is India (every pre-region save). */
export function regionOf(settings: { country: string }): Region {
  return settings.country === "US" ? "US" : "IN";
}

export const profileFor = (settings: { country: string }): RegionProfile =>
  PROFILES[regionOf(settings)];

// Store-backed convenience for COMPONENTS: format in the current region's style. Every
// money-rendering component subscribes to the portfolio, so a region change re-renders
// them and this reads fresh. Pure domain modules keep taking parameters instead.
export const fmtMoney = (value: number, opts?: { compact?: boolean }): string =>
  profileFor(useStore.getState().portfolio.settings).formatMoney(value, opts);
