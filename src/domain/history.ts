// Time-period helpers and price-series types for the net-worth trend. The trend chart draws the
// RECORDED daily snapshots (see NetWorthTrend / snapshots.ts) — this module owns the period
// windows (1M…All), the change calc, and the Series type that market.ts fills for live prices.

export interface PricePoint { t: number; price: number; } // t = epoch ms, ascending
export type Series = PricePoint[];
export type Period = "1M" | "3M" | "YTD" | "1Y" | "2Y" | "5Y" | "All";
export const PERIODS: Period[] = ["1M", "3M", "YTD", "1Y", "2Y", "5Y", "All"];

// Start of the lookback window for a period.
export function periodStart(period: Period, now = Date.now()): number {
  const d = new Date(now);
  switch (period) {
    case "1M": d.setMonth(d.getMonth() - 1); break;
    case "3M": d.setMonth(d.getMonth() - 3); break;
    case "1Y": d.setFullYear(d.getFullYear() - 1); break;
    case "2Y": d.setFullYear(d.getFullYear() - 2); break;
    case "5Y": d.setFullYear(d.getFullYear() - 5); break;
    case "YTD": return new Date(d.getFullYear(), 0, 1).getTime();
    case "All": return -Infinity; // the whole record, however many years it spans
  }
  return d.getTime();
}

// Latest known price (last point of an ascending series).
export const latestPrice = (s: Series): number | null => (s.length ? s[s.length - 1].price : null);

export interface NetWorthPoint { t: number; netWorth: number; }

// Change between the first and last point of a net-worth series.
export function periodChange(points: NetWorthPoint[]): { abs: number; pct: number | null } {
  if (points.length < 2) return { abs: 0, pct: null };
  const first = points[0].netWorth;
  const last = points[points.length - 1].netWorth;
  return { abs: last - first, pct: first ? Math.round(((last - first) / Math.abs(first)) * 1000) / 10 : null };
}
