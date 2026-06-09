// Net-worth-over-time card. Reconstructs PAST net worth (1M/3M/YTD/1Y) from public historical
// prices — listed equities/ETFs & gold via Yahoo, Indian MFs via AMFI/mfapi — anchored to each
// holding's current value, carrying untrackable assets flat. Only tickers/ISINs ever leave the
// device. The chart honors the account include/exclude selection: the price series are fetched
// once for the whole portfolio, then the curve is recomputed over the *visible* holdings, so
// toggling an account reconfigures it instantly with no re-fetch.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio, type Holding } from "../domain/types";
import { buildResolver, type Resolver } from "../domain/market";
import {
  PERIODS, periodChange, periodStart, reconstruct, sampleDates, type NetWorthPoint, type Period,
} from "../domain/history";
import { inr } from "../domain/format";

// Cache the fetched series for the session (keyed by the portfolio's holdings) so switching
// views or toggling accounts doesn't re-hit the network.
let CACHE: { sig: string; resolver: Resolver } | null = null;
const sigOf = (hs: Holding[]) => hs.map((h) => `${h.id}:${h.symbol ?? ""}:${h.assetClass}`).sort().join("|");

function Chart({ points }: { points: NetWorthPoint[] }) {
  const W = 720, H = 180, PAD = 6;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.netWorth);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || Math.abs(maxY) || 1;
  const x = (t: number) => PAD + ((t - minX) / spanX) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - minY) / spanY) * (H - 2 * PAD);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxX).toFixed(1)},${H - PAD} L${x(minX).toFixed(1)},${H - PAD} Z`;
  const up = ys[ys.length - 1] >= ys[0];
  const stroke = up ? "#1a9e6b" : "#d6455d";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="nwfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#nwfill)" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function NetWorthTrend() {
  const portfolio = useStore((s) => s.portfolio);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(() => {
    return CACHE && CACHE.sig === sigOf(portfolio.holdings) ? "ready" : "idle";
  });
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("1Y");
  const [resolver, setResolver] = useState<Resolver | null>(() =>
    CACHE && CACHE.sig === sigOf(portfolio.holdings) ? CACHE.resolver : null,
  );

  const usdInr = portfolio.settings.usdInr;
  const visible = useMemo(() => visiblePortfolio(portfolio), [portfolio]);

  // Reconstruct over the VISIBLE holdings for the selected period (cheap, no network).
  const { points, change, trackedVisible } = useMemo(() => {
    if (!resolver) return { points: [] as NetWorthPoint[], change: { abs: 0, pct: null as number | null }, trackedVisible: 0 };
    const dates = sampleDates(periodStart(period));
    const pts = reconstruct(visible.holdings, visible.accounts, usdInr, resolver.resolve, dates);
    const tv = visible.holdings.filter((h) => resolver.resolve(h)).length;
    return { points: pts, change: periodChange(pts), trackedVisible: tv };
  }, [resolver, visible, period, usdInr]);

  const load = async () => {
    setStatus("loading");
    setError(null);
    try {
      const r = await buildResolver(portfolio.holdings, "1y");
      CACHE = { sig: sigOf(portfolio.holdings), resolver: r };
      setResolver(r);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  if (portfolio.holdings.length === 0) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <div className="eyebrow">Net worth over time</div>
          <h2 style={{ fontSize: "1.15rem", marginTop: "0.15rem" }}>How your net worth got here</h2>
        </div>
        {status === "ready" && (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {PERIODS.map((p) => (
              <button key={p} className={`chip ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
            <button className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={load} title="Re-fetch latest prices">↻</button>
          </div>
        )}
      </div>

      {status === "idle" && (
        <div style={{ marginTop: "0.8rem" }}>
          <p className="muted" style={{ fontSize: "0.84rem", maxWidth: 560 }}>
            Reconstruct your net worth for the past year from public market prices. Equities, ETFs,
            mutual funds and gold are revalued historically; everything else (property, FDs, cash,
            PMS) is held flat. Only tickers/ISINs are sent to fetch prices — never your holdings.
          </p>
          <button className="btn btn-primary" style={{ marginTop: "0.7rem" }} onClick={load}>📈 Reconstruct net-worth history</button>
        </div>
      )}

      {status === "loading" && (
        <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span className="spinner" /> <span className="muted">Fetching historical prices…</span>
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: "0.9rem" }}>
          <div className="badge badge-rose" style={{ padding: "0.4rem 0.7rem", display: "block" }}>
            Couldn't load price history{error ? `: ${error}` : ""}. {window.navigator.onLine ? "" : "You appear to be offline. "}
          </div>
          <button className="btn" style={{ marginTop: "0.6rem" }} onClick={load}>Retry</button>
        </div>
      )}

      {status === "ready" && points.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>{inr(points[points.length - 1].netWorth)}</div>
            <div style={{ fontWeight: 700, color: change.abs >= 0 ? "#1a9e6b" : "#d6455d" }}>
              {change.abs >= 0 ? "▲" : "▼"} {inr(Math.abs(change.abs))}{change.pct != null ? ` · ${change.pct >= 0 ? "+" : ""}${change.pct}%` : ""}
              <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}> over {period}</span>
            </div>
          </div>
          <Chart points={points} />
          <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.5rem" }}>
            {trackedVisible} of {visible.holdings.length} visible holding{visible.holdings.length === 1 ? "" : "s"} priced from market history;
            the rest are held flat at today's value. A reconstruction (today's mix back-priced), not a recorded daily history.
            {resolver && resolver.tracked === 0 && " No holdings could be priced — check that symbols/ISINs are set."}
          </p>
        </div>
      )}
    </div>
  );
}
