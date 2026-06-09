// INR-first formatting (lakh / crore) plus FX into the base currency.

import type { Holding } from "./types";

// Convert a holding's value into the base currency. v1 supports INR + USD (manual rate);
// anything else is treated 1:1 and surfaced as a warning elsewhere.
export function toBase(value: number, currency: string, usdInr: number): number {
  const c = (currency || "INR").toUpperCase();
  if (c === "INR") return value;
  if (c === "USD") return value * usdInr;
  return value;
}

export const holdingBase = (h: Holding, usdInr: number) =>
  toBase(h.marketValue, h.currency, usdInr);

export interface HoldingGain {
  invested: number; // cost basis in INR base
  gain: number; // value − invested, INR base
  gainPct: number | null; // null when invested is 0
  estimated: boolean; // basis is a since-first-import anchor, not a real purchase cost
}

// Unrealized P&L for one holding, in the INR base. Basis and value convert at the SAME rate,
// so a USD position's P&L is pure price movement (no FX term). Null when no basis at all.
export function holdingGain(h: Holding, usdInr: number): HoldingGain | null {
  if (h.costBasis == null) return null;
  const invested = toBase(h.costBasis, h.currency, usdInr);
  const gain = holdingBase(h, usdInr) - invested;
  return {
    invested,
    gain,
    gainPct: invested > 0 ? Math.round((gain / invested) * 1000) / 10 : null,
    estimated: !!h.costBasisEstimated,
  };
}

// Indian grouping: ₹ with lakh/crore for big numbers, plain for small.
export function inr(value: number, opts: { compact?: boolean } = {}): string {
  const neg = value < 0;
  const a = Math.abs(value);
  let body: string;
  if (opts.compact === false) {
    body = "₹" + Math.round(a).toLocaleString("en-IN");
  } else if (a >= 1e7) {
    body = `₹${(a / 1e7).toFixed(2)} Cr`;
  } else if (a >= 1e5) {
    body = `₹${(a / 1e5).toFixed(2)} L`;
  } else {
    body = "₹" + Math.round(a).toLocaleString("en-IN");
  }
  return neg ? "−" + body : body;
}

export const pct = (part: number, whole: number): number =>
  whole ? Math.round((1000 * part) / whole) / 10 : 0;
