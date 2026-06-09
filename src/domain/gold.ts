// Live gold price → ₹ per gram (24K), for valuing gold holdings by weight instead of asking
// for a rupee amount. Source is XAU/USD per troy ounce (free, no key); we convert to INR
// using the app's USD→INR rate. Best-effort: any failure returns null and the caller falls
// back to a manual price. Sends no user data.

const GOLD_URL = "https://api.gold-api.com/price/XAU";
const TROY_OZ_GRAMS = 31.1034768;

// USD/troy-oz → ₹/gram. Pure, so it can be unit-tested without a network call.
export function goldPerGramInr(usdPerOz: unknown, usdInr: number): number | null {
  if (typeof usdPerOz !== "number" || !Number.isFinite(usdPerOz) || usdPerOz <= 0) return null;
  if (!Number.isFinite(usdInr) || usdInr <= 0) return null;
  return Math.round((usdPerOz * usdInr) / TROY_OZ_GRAMS);
}

export async function fetchGoldPerGramInr(usdInr: number, signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(GOLD_URL, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: unknown };
    return goldPerGramInr(data?.price, usdInr);
  } catch {
    return null;
  }
}
