// Allocation grouping — a multi-dimensional port of tally/frontend/src/group.ts.
// Builds donut/table segments from holdings, grouped by any dimension, fully client-side.

import { ASSET_CLASS_LABEL, ACCOUNT_TYPE_LABEL, TAX_LABEL, rankAssetClass } from "./classify";
import { holdingBase } from "./format";
import type { Account, AssetClass, Holding } from "./types";

export type Dimension =
  | "asset_class" | "account" | "region" | "tax" | "account_type" | "institution";

export const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "asset_class", label: "Type" },
  { key: "account", label: "Account" },
  { key: "tax", label: "How it's taxed" },
  { key: "region", label: "Region" },
  { key: "account_type", label: "Account type" },
  { key: "institution", label: "Institution" },
];

export interface Segment {
  key: string;
  label: string;
  value: number; // base currency
  percent: number;
  color?: string; // semantic color (bucket views); falls back to the rotating palette
}

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// The grouping key for one holding along a dimension. Accounts are looked up by id.
export function keyFor(h: Holding, acct: Account | undefined, by: Dimension): { key: string; label: string } {
  const a = acct;
  switch (by) {
    case "asset_class":
      return { key: h.assetClass, label: ASSET_CLASS_LABEL[h.assetClass] ?? pretty(h.assetClass) };
    case "account":
      return { key: a?.id ?? "?", label: a?.name ?? "Unknown" };
    case "region":
      return { key: a?.region ?? "India", label: a?.region ?? "India" };
    case "tax":
      return { key: a?.taxTreatment ?? "taxable", label: TAX_LABEL[a?.taxTreatment ?? "taxable"] };
    case "account_type":
      return { key: a?.accountType ?? "other", label: ACCOUNT_TYPE_LABEL[a?.accountType ?? "other"] };
    case "institution":
      return { key: a?.institution ?? "—", label: a?.institution ?? "—" };
  }
}

export function buildSegments(
  holdings: Holding[], accounts: Account[], by: Dimension, usdInr: number,
): { total: number; segments: Segment[] } {
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const vals = new Map<string, { label: string; value: number }>();
  let total = 0;
  for (const h of holdings) {
    const v = holdingBase(h, usdInr);
    const { key, label } = keyFor(h, acctById.get(h.accountId), by);
    const cur = vals.get(key) ?? { label, value: 0 };
    cur.value += v;
    vals.set(key, cur);
    total += v;
  }
  const denom = total || 1;
  const segments = [...vals.entries()].map(([key, { label, value }]) => ({
    key, label, value, percent: Math.round((1000 * value) / denom) / 10,
  }));
  segments.sort(
    by === "asset_class"
      ? (a, b) => rankAssetClass(a.key as AssetClass) - rankAssetClass(b.key as AssetClass) || b.value - a.value
      : (a, b) => b.value - a.value,
  );
  return { total, segments };
}
