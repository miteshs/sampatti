// Live USD→INR rate from a free, no-key, CORS-enabled source. It sends no user data — it
// only asks for a public exchange rate — and is best-effort: any failure returns null so
// the caller keeps the existing (manual or default) rate rather than breaking.

const FX_URL = "https://open.er-api.com/v6/latest/USD";

// Pulled out so it can be unit-tested without a network call.
export function parseUsdInr(data: unknown): number | null {
  const inr = (data as { rates?: { INR?: unknown } } | null)?.rates?.INR;
  return typeof inr === "number" && Number.isFinite(inr) && inr > 0
    ? Math.round(inr * 100) / 100
    : null;
}

export async function fetchUsdInr(signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(FX_URL, { signal });
    if (!res.ok) return null;
    return parseUsdInr(await res.json());
  } catch {
    return null;
  }
}
