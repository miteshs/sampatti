// Small shared UI helpers: a harmonious segment palette and freshness coloring.

export const PALETTE = [
  "#4f46e5", "#0fb37a", "#0ea5e9", "#f59e0b", "#ec4899", "#7c6cf6",
  "#14b8a6", "#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#eab308",
  "#f97316", "#06b6d4", "#8b5cf6", "#64748b",
];

export const color = (i: number) => PALETTE[i % PALETTE.length];

export type FreshStatus = "fresh" | "aging" | "stale" | "unknown";

export function freshness(asOf: string | undefined): { status: FreshStatus; days: number | null } {
  if (!asOf) return { status: "unknown", days: null };
  const days = Math.floor((Date.now() - new Date(asOf).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return { status: "unknown", days: null };
  if (days <= 35) return { status: "fresh", days };
  if (days <= 120) return { status: "aging", days };
  return { status: "stale", days };
}

export const FRESH_BADGE: Record<FreshStatus, string> = {
  fresh: "badge-green", aging: "badge-amber", stale: "badge-rose", unknown: "badge-gray",
};
