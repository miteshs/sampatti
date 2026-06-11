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
  /** Manual-entry pickers hide market-foreign classes; existing holdings still render. */
  inManualEntry(assetClass: string): boolean;
  /** The FX control's label — the stored pair is always ₹ per $, whichever side is home. */
  fxLabel: string;
  /** Gold entered by weight at the live ₹/gram rate is an India affordance. */
  goldByWeight: boolean;
  /** Tax-treatment picker order for this market (existing values still render via TAX_LABEL). */
  taxTreatments: string[];
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
    inManualEntry: () => true,
    fxLabel: "USD → INR rate (for US holdings)",
    goldByWeight: true,
    taxTreatments: ["taxable", "eee_exempt", "nps", "na"],
  },
  US: {
    region: "US",
    country: "US",
    label: "United States",
    baseCurrency: "USD",
    symbol: "$",
    formatMoney: usd,
    adviserNoun: "fiduciary adviser (RIA/CFP)",
    // India-specific wrappers/instruments stay out of US pickers (existing holdings of
    // these classes still render fine — only the picker filters). indian_equity stays:
    // NRI-style mixed portfolios are a real US-resident case.
    inManualEntry: (c) => !["elss", "nps", "epf_ppf", "gold_sgb", "pms"].includes(c),
    fxLabel: "INR → USD rate (₹ per $, for Indian holdings)",
    goldByWeight: false,
    taxTreatments: ["taxable", "us_pretax", "us_roth", "us_hsa", "na"],
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
//
// THE UNIT RULE (docs/regions.md): the app's internal unit is ALWAYS INR — stored
// snapshots/flows and every computation stay in it, so switching region never rewrites
// data. Conversion to the region's display currency happens here, at the display edge,
// and in buildBrief for the outbound brief — nowhere else.
// Store-backed profile lookup for components (same re-render caveat as fmtMoney).
export const currentProfile = (): RegionProfile => profileFor(useStore.getState().portfolio.settings);

export const fmtMoney = (value: number, opts?: { compact?: boolean }): string => {
  const s = useStore.getState().portfolio.settings;
  const p = profileFor(s);
  const v = p.baseCurrency === "USD" ? value / (s.usdInr || 1) : value;
  return p.formatMoney(v, opts);
};
