// "Market history (simulated)" — Performance tab. Takes TODAY'S holdings and back-prices
// them through the past year with public market data (Yahoo for listed equities/ETFs/gold,
// AMFI/mfapi for Indian MF NAVs), anchored to current values; unpriceable assets (property,
// FDs, cash, PMS) carry flat. This is a WHAT-IF curve — it ignores buys/sells/contributions
// during the period — which is why it lives here and not on Overview: the real, recorded
// net-worth history is NetWorthTrend. Only tickers/ISINs ever leave the device.
//
// Fetched price series are cached to localStorage so the curve shows instantly on later
// launches; refresh (↻) for fresher prices or when a new priceable holding appears.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio } from "../domain/types";
import { buildResolver, resolverFromData, coversHoldings, type Resolver, type ResolverData } from "../domain/market";
import {
  PERIODS, periodChange, periodStart, reconstruct, sampleDates, type NetWorthPoint, type Period,
} from "../domain/history";
import { inr } from "../domain/format";
import { TrendChart } from "./TrendChart";

const CACHE_KEY = "sampatti.nwhistory.v1";
interface Cached { fetchedAt: string; data: ResolverData; }

function readCache(): Cached | null {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? (JSON.parse(raw) as Cached) : null; }
  catch { return null; }
}
function writeCache(data: ResolverData) {
  // Bound storage: keep only the last ~400 points per series (covers a year of dailies).
  const seriesByKey = Object.fromEntries(Object.entries(data.seriesByKey).map(([k, s]) => [k, s.slice(-400)]));
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), data: { ...data, seriesByKey } })); }
  catch { /* quota exceeded — fine, just won't persist */ }
}

export function MarketHistory() {
  const portfolio = useStore((s) => s.portfolio);
  const usdInr = portfolio.settings.usdInr;
  const visible = useMemo(() => visiblePortfolio(portfolio), [portfolio]);

  const [period, setPeriod] = useState<Period>("1Y");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolver, setResolver] = useState<Resolver | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  // Load persisted series once on mount so the curve appears without re-fetching.
  useEffect(() => {
    const c = readCache();
    if (c) { setResolver(resolverFromData(c.data, portfolio.holdings)); setFetchedAt(c.fetchedAt); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache no longer covers the portfolio (a new priceable holding was added) → offer a refresh.
  const stale = useMemo(
    () => (resolver ? !coversHoldings(resolver.data, portfolio.holdings) : false),
    [resolver, portfolio.holdings],
  );

  const { points, change, trackedVisible } = useMemo(() => {
    if (!resolver) return { points: [] as NetWorthPoint[], change: { abs: 0, pct: null as number | null }, trackedVisible: 0 };
    const pts = reconstruct(visible.holdings, visible.accounts, usdInr, resolver.resolve, sampleDates(periodStart(period)));
    return { points: pts, change: periodChange(pts), trackedVisible: visible.holdings.filter((h) => resolver.resolve(h)).length };
  }, [resolver, visible, period, usdInr]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await buildResolver(portfolio.holdings, "1y");
      writeCache(r.data);
      setResolver(r);
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (visible.holdings.length === 0) return null;

  const asOf = fetchedAt ? new Date(fetchedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <div className="eyebrow">Market history · simulated</div>
          <h2 style={{ fontSize: "1.15rem", marginTop: "0.15rem" }}>How today's portfolio rode the market</h2>
        </div>
        {resolver && (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
            {PERIODS.map((p) => (
              <button key={p} className={`chip ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
            <button className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={load} disabled={loading} title="Re-fetch latest prices">
              {loading ? <span className="spinner" /> : "↻"}
            </button>
          </div>
        )}
      </div>

      {!resolver && !loading && (
        <div style={{ marginTop: "0.8rem" }}>
          <p className="muted" style={{ fontSize: "0.84rem", maxWidth: 580 }}>
            Simulate the past year for your <strong>current</strong> holdings: equities, ETFs, mutual
            funds and gold are back-priced with public market data; everything else (property, FDs,
            cash, PMS) is held flat. A what-if curve — it ignores buys, sells and contributions along
            the way (your <em>actual</em> net worth is recorded daily on Overview). Only tickers/ISINs
            are sent — never your holdings. Cached on this device after the first run.
          </p>
          <button className="btn btn-primary" style={{ marginTop: "0.7rem" }} onClick={load}>📈 Simulate from market data</button>
          {error && (
            <div className="badge badge-rose" style={{ marginTop: "0.7rem", padding: "0.4rem 0.7rem", display: "inline-block" }}>
              Couldn't load price history: {error}. {window.navigator.onLine ? "" : "You appear to be offline."}
            </div>
          )}
        </div>
      )}

      {!resolver && loading && (
        <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span className="spinner" /> <span className="muted">Fetching historical prices…</span>
        </div>
      )}

      {resolver && points.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 750, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{inr(points[points.length - 1].netWorth)}</div>
            <div style={{ fontWeight: 700, color: change.abs >= 0 ? "#1a9e6b" : "#d6455d" }}>
              {change.abs >= 0 ? "▲" : "▼"} {inr(Math.abs(change.abs))}{change.pct != null ? ` · ${change.pct >= 0 ? "+" : ""}${change.pct}%` : ""}
              <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}> over {period} · simulated</span>
            </div>
          </div>
          <TrendChart points={points} simulated />
          {stale && (
            <div className="badge badge-amber" style={{ marginTop: "0.5rem", padding: "0.35rem 0.6rem", display: "inline-block" }}>
              Holdings changed since the last refresh — ↻ to price the new ones.
            </div>
          )}
          {error && (
            <div className="badge badge-rose" style={{ marginTop: "0.5rem", padding: "0.35rem 0.6rem", display: "inline-block" }}>
              Couldn't refresh prices: {error} — showing the last cached run.
            </div>
          )}
          <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.5rem" }}>
            ┄ Simulated: today's mix back-priced through the period — not your actual history (buys,
            sells and contributions are ignored). {trackedVisible} of {visible.holdings.length} visible
            holding{visible.holdings.length === 1 ? "" : "s"} priced from market data; the rest held flat at today's value.
            {asOf ? ` Prices as of ${asOf}.` : ""} Honors the account selection on Manage.
          </p>
        </div>
      )}
    </div>
  );
}
