// Lay-person allocation buckets. The donut's job on Overview is a first read for someone
// who doesn't speak finance — six plain groups with meaningful colors — while the detail
// table below keeps all 21 asset classes. Colors are semantic (one hue per money-family),
// not a rotating palette.

import { holdingBase } from "./format";
import type { Account, AssetClass, Holding } from "./types";
import type { Segment } from "./group";

export type BucketKey = "equity" | "fixed" | "property" | "gold" | "managed" | "cash_other";

export const BUCKET_META: Record<BucketKey, { label: string; color: string }> = {
  equity: { label: "Stocks & equity funds", color: "#4845e5" }, // the indigo accent — growth money
  fixed: { label: "Fixed income & retirement", color: "#0e9f6e" }, // calm green — the safe base
  property: { label: "Property & REITs", color: "#b9722a" }, // brick
  gold: { label: "Gold", color: "#d9a514" }, // gold
  managed: { label: "PMS, private & alternates", color: "#8b5cf6" }, // violet — managed money
  cash_other: { label: "Cash & other", color: "#8a8675" }, // warm slate
};

// Exhaustive by construction: adding an AssetClass without choosing its bucket is a type
// error, so a new class can never silently fall out of the Overview donut.
export const CLASS_BUCKET: Record<AssetClass, BucketKey> = {
  indian_equity: "equity",
  equity_mf: "equity",
  index_etf: "equity",
  elss: "equity",
  us_equity: "equity",
  debt_mf: "fixed",
  fd_rd: "fixed",
  epf_ppf: "fixed",
  nps: "fixed",
  insurance: "fixed",
  structured_notes: "fixed",
  real_estate: "property",
  reit_invit: "property",
  gold_sgb: "gold",
  gold_other: "gold",
  pms: "managed",
  private_equity: "managed",
  private_credit: "managed",
  crypto: "cash_other",
  cash: "cash_other",
  other: "cash_other",
};

export interface BucketSegment extends Segment {
  color: string;
  classes: AssetClass[]; // the detail-table keys inside this bucket (for click-to-expand)
}

const ORDER: BucketKey[] = ["equity", "fixed", "property", "gold", "managed", "cash_other"];

// Group holdings into the six buckets, in fixed order, empty buckets dropped.
// Liability-account holdings are excluded: a mortgage is not "where your money sits"
// (it once inflated the donut's total above the assets figure — same bug as buildSegments).
export function bucketSegments(holdings: Holding[], accounts: Account[], usdInr: number): { total: number; segments: BucketSegment[] } {
  const liability = new Set(accounts.filter((a) => a.accountType === "liability").map((a) => a.id));
  const sums = new Map<BucketKey, { value: number; classes: Set<AssetClass> }>();
  let total = 0;
  for (const h of holdings) {
    if (liability.has(h.accountId)) continue;
    const v = holdingBase(h, usdInr);
    const b = CLASS_BUCKET[h.assetClass] ?? "cash_other";
    const cur = sums.get(b) ?? { value: 0, classes: new Set<AssetClass>() };
    cur.value += v;
    cur.classes.add(h.assetClass);
    sums.set(b, cur);
    total += v;
  }
  const segments: BucketSegment[] = ORDER.filter((k) => sums.has(k)).map((k) => {
    const { value, classes } = sums.get(k)!;
    return {
      key: k,
      label: BUCKET_META[k].label,
      color: BUCKET_META[k].color,
      value,
      percent: total ? Math.round((value / total) * 1000) / 10 : 0,
      classes: [...classes],
    };
  });
  return { total, segments };
}
