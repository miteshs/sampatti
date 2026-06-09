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
