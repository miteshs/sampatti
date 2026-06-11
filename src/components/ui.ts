// Small shared UI helpers: a harmonious segment palette and freshness coloring.

// Editorial atlas ramp, not default-library candy: warm, medium-saturation inks that sit
// on the paper ground with the brand indigo. Ordered so neighbours differ in both hue
// family and lightness — adjacent bands in the stacked chart stay separable.
export const PALETTE = [
  "#4845e5", "#0e9f6e", "#d98324", "#5e8ca7", "#b65d4f", "#7a6ff0",
  "#3e7d5f", "#b8921f", "#8a5a83", "#2f6f8f", "#a8755c", "#5d669c",
  "#6f8f3f", "#b25668", "#4a7d77", "#8c8678",
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
