// Net-worth-over-time card, built from two layers:
//   • RECORDED history — daily per-account snapshots the store writes on every change/launch
//     (the truth, FX-of-the-day included; honors account include/exclude at render time).
//   • RECONSTRUCTED back-fill — for time before the first snapshot, past net worth is rebuilt
//     from public price series (Yahoo / AMFI / mfapi) anchored to each holding's current value,
//     untrackable assets carried flat. Only tickers/ISINs ever leave the device.
// Recorded points draw solid; the reconstructed prefix draws dashed so the difference is honest.
//
// Fetched price series are cached to localStorage, so after the first reconstruction the chart
// shows instantly on every later launch WITHOUT re-fetching — refresh (↻) when you want fresher
// prices or when a new priceable holding appears.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio } from "../domain/types";
import { buildResolver, resolverFromData, coversHoldings, type Resolver, type ResolverData } from "../domain/market";
import {
  PERIODS, periodChange, periodStart, reconstruct, sampleDates, type NetWorthPoint, type Period,
} from "../domain/history";
import { mergeHistory, snapshotSeries } from "../domain/snapshots";
import { inr } from "../domain/format";

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

// Reconstructed prefix (dashed) + recorded curve (solid). `recon`'s last point, when present,
// is bridged into the recorded path so the curve reads as one line.
function Chart({ recon, recorded }: { recon: NetWorthPoint[]; recorded: NetWorthPoint[] }) {
  const W = 720, H = 180, PAD = 6;
  const all = [...recon, ...recorded];
  const xs = all.map((p) => p.t);
  const ys = all.map((p) => p.netWorth);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || Math.abs(maxY) || 1;
  const x = (t: number) => PAD + ((t - minX) / spanX) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - minY) / spanY) * (H - 2 * PAD);
  const path = (pts: NetWorthPoint[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");

  // Bridge the dashed prefix into the first recorded point so there is no visual gap.
  const reconDraw = recon.length && recorded.length ? [...recon, recorded[0]] : recon;
  const solid = recorded.length ? path(recorded) : "";
  const dashed = reconDraw.length > 1 ? path(reconDraw) : "";
  const area = all.length > 1
    ? `${path(all)} L${x(maxX).toFixed(1)},${H - PAD} L${x(minX).toFixed(1)},${H - PAD} Z`
    : "";
  const up = ys[ys.length - 1] >= ys[0];
  const stroke = up ? "#1a9e6b" : "#d6455d";
  const last = all[all.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="nwfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill="url(#nwfill)" />}
      {dashed && <path d={dashed} fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="5 4" strokeOpacity="0.6" strokeLinejoin="round" strokeLinecap="round" />}
      {solid && <path d={solid} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
      {last && <circle cx={x(last.t)} cy={y(last.netWorth)} r="3.2" fill={stroke} />}
    </svg>
  );
}

export function NetWorthTrend() {
  const portfolio = useStore((s) => s.portfolio);
  const usdInr = portfolio.settings.usdInr;
  const visible = useMemo(() => visiblePortfolio(portfolio), [portfolio]);

  const [period, setPeriod] = useState<Period>("1Y");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolver, setResolver] = useState<Resolver | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  // Load persisted series once on mount so the back-fill appears without re-fetching.
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

  // Recorded daily snapshots over the currently-visible accounts (the truth, where it exists)…
  const startT = useMemo(() => periodStart(period), [period]);
  const recorded = useMemo(
    () => snapshotSeries(portfolio.snapshots ?? [], new Set(visible.accounts.map((a) => a.id)), startT),
    [portfolio.snapshots, visible.accounts, startT],
  );

  // …and the reconstructed prefix for time before the first snapshot.
  const { reconPart, points, change, trackedVisible } = useMemo(() => {
    const reconPts = resolver
      ? reconstruct(visible.holdings, visible.accounts, usdInr, resolver.resolve, sampleDates(startT))
      : [];
    const merged = mergeHistory(reconPts, recorded);
    return {
      reconPart: merged.recordedFromT == null ? merged.points : merged.points.filter((p) => p.t < merged.recordedFromT!),
      points: merged.points,
      change: periodChange(merged.points),
      trackedVisible: resolver ? visible.holdings.filter((h) => resolver.resolve(h)).length : 0,
    };
  }, [resolver, visible, recorded, startT, usdInr]);

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

  if (portfolio.holdings.length === 0) return null;

  const haveChart = points.length >= 2;
  const recordedDays = (portfolio.snapshots ?? []).length;
  const asOf = fetchedAt ? new Date(fetchedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <div className="eyebrow">Net worth over time</div>
          <h2 style={{ fontSize: "1.15rem", marginTop: "0.15rem" }}>How your net worth got here</h2>
        </div>
        {haveChart && (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
            {PERIODS.map((p) => (
              <button key={p} className={`chip ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
            <button className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={load} disabled={loading}
              title={resolver ? "Re-fetch latest prices" : "Back-fill the past year from market prices"}>
              {loading ? <span className="spinner" /> : resolver ? "↻" : "📈 Back-fill 1Y"}
            </button>
          </div>
        )}
      </div>

      {/* Nothing to draw yet: recording has started, but the back-fill is what makes a curve */}
      {!haveChart && !loading && (
        <div style={{ marginTop: "0.8rem" }}>
          <p className="muted" style={{ fontSize: "0.84rem", maxWidth: 560 }}>
            Sampatti now records your net worth automatically every day you open it
            {recordedDays > 0 ? ` (${recordedDays} day${recordedDays === 1 ? "" : "s"} so far)` : ""} — the chart
            builds itself from here. To see the past year right away, reconstruct it from public market
            prices: equities, ETFs, mutual funds and gold are revalued historically; everything else
            (property, FDs, cash, PMS) is held flat. Only tickers/ISINs are sent — never your holdings.
          </p>
          <button className="btn btn-primary" style={{ marginTop: "0.7rem" }} onClick={load}>📈 Reconstruct net-worth history</button>
          {error && (
            <div className="badge badge-rose" style={{ marginTop: "0.7rem", padding: "0.4rem 0.7rem", display: "inline-block" }}>
              Couldn't load price history: {error}. {window.navigator.onLine ? "" : "You appear to be offline."}
            </div>
          )}
        </div>
      )}

      {!haveChart && loading && (
        <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span className="spinner" /> <span className="muted">Fetching historical prices…</span>
        </div>
      )}

      {haveChart && (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>{inr(points[points.length - 1].netWorth)}</div>
            <div style={{ fontWeight: 700, color: change.abs >= 0 ? "#1a9e6b" : "#d6455d" }}>
              {change.abs >= 0 ? "▲" : "▼"} {inr(Math.abs(change.abs))}{change.pct != null ? ` · ${change.pct >= 0 ? "+" : ""}${change.pct}%` : ""}
              <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}> over {period}</span>
            </div>
          </div>
          <Chart recon={reconPart} recorded={recorded} />
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
            <strong>—</strong> recorded daily as you use the app ({recordedDays} day{recordedDays === 1 ? "" : "s"} on file)
            {reconPart.length > 0 && <> · <strong>┄</strong> earlier curve reconstructed from market prices (today's mix back-priced
            {trackedVisible > 0 ? `; ${trackedVisible} of ${visible.holdings.length} visible holdings priced, rest held flat` : ""}
            {asOf ? `; prices as of ${asOf}` : ""})</>}.
          </p>
        </div>
      )}
    </div>
  );
}
