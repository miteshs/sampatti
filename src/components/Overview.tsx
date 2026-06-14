import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { buildBrief } from "../domain/brief";
import { buildSegments, keyFor, DIMENSIONS, type Dimension } from "../domain/group";
import { holdingBase, pct } from "../domain/format";
import { fmtMoney } from "../regions/profile";
import { ASSET_CLASS_LABEL } from "../domain/classify";
import { bucketSegments } from "../domain/buckets";
import { groupHoldings, tickerOf } from "../domain/aggregate";
import { concentrationVerdict, equityVerdict, liquidityVerdict, type Verdict } from "../domain/verdicts";
import { portfolioHealth } from "../domain/health";
import { Goals } from "./Goals";
import { snapshotSeries } from "../domain/snapshots";
import { visiblePortfolio, type Account, type AssetClass, type Holding } from "../domain/types";
import { Donut } from "./Donut";
import { NetWorthTrend } from "./NetWorthTrend";

// Sweep the hero figure up to its value once on load — a quiet moment of reward, skipped
// entirely for reduced-motion users and in environments without rAF (tests).
function useCountUp(target: number, ms = 700): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef<number | null>(null);
  useEffect(() => {
    const still =
      typeof requestAnimationFrame === "undefined" ||
      (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const from = fromRef.current ?? (still ? target : 0);
    fromRef.current = target;
    if (still || from === target) { setVal(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

function StatCard({ label, value, sub, verdict }: { label: string; value: string; sub?: string; verdict?: Verdict }) {
  return (
    <div className="card" style={{ padding: "1.25rem 1.4rem" }}>
      <div className="eyebrow">{label}</div>
      <div className="hero-num" style={{
        fontSize: "1.6rem", marginTop: "0.4rem",
      }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: "0.82rem", marginTop: "0.2rem" }}>{sub}</div>}
      {verdict && (
        <div className={`verdict ${verdict.tone}`}>
          <span className="dot" />
          <span>{verdict.text}</span>
        </div>
      )}
    </div>
  );
}

const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function Overview() {
  const portfolio = useStore((s) => s.portfolio);
  const [by, setBy] = useState<Dimension>("asset_class");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const usdInr = portfolio.settings.usdInr;

  // Everything the dashboard shows runs on the *visible* portfolio (excluded accounts
  // dropped), so the include/exclude toggle on Manage affects totals, allocation, the table.
  const view = useMemo(() => visiblePortfolio(portfolio), [portfolio]);

  const brief = useMemo(() => buildBrief(view), [view]);
  const { total, segments } = useMemo(
    () => buildSegments(view.holdings, view.accounts, by, usdInr),
    [view, by, usdInr],
  );

  // The donut's first read: six plain-language buckets with semantic colors. The detail
  // table below stays full-granularity; clicking a bucket expands its classes there.
  const buckets = useMemo(() => bucketSegments(view.holdings, view.accounts, usdInr), [view.holdings, view.accounts, usdInr]);

  const acctById = useMemo(() => new Map(view.accounts.map((a) => [a.id, a])), [view.accounts]);

  // Holdings grouped by the active dimension (same keys the detail table uses), so each
  // segment row can expand to reveal the holdings inside it.
  const grouped = useMemo(() => {
    const m = new Map<string, { h: Holding; a?: Account; base: number }[]>();
    for (const h of view.holdings) {
      const a = acctById.get(h.accountId);
      const { key } = keyFor(h, a, by);
      const list = m.get(key) ?? [];
      list.push({ h, a, base: holdingBase(h, usdInr) });
      m.set(key, list);
    }
    for (const list of m.values()) list.sort((x, y) => y.base - x.base);
    return m;
  }, [view.holdings, acctById, usdInr, by]);

  const dimLabel = DIMENSIONS.find((d) => d.key === by)?.label ?? "";
  const allExpanded = segments.length > 0 && segments.every((s) => expanded.has(s.key));
  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // A donut click in bucket view opens (or closes) every class inside that bucket.
  const toggleBucket = (bucketKey: string) => {
    const b = buckets.segments.find((s) => s.key === bucketKey);
    if (!b) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      const allOpen = b.classes.every((c) => next.has(c));
      for (const c of b.classes) allOpen ? next.delete(c) : next.add(c);
      return next;
    });
  };

  // Headline metrics. Equity exposure = all public-equity classes as a share of assets (the
  // growth/risk dial); top-10 concentration = your 10 biggest positions as a share of assets.
  const EQUITY = new Set<AssetClass>(["indian_equity", "equity_mf", "index_etf", "elss", "us_equity"]);
  const equityBase = view.holdings.filter((h) => EQUITY.has(h.assetClass)).reduce((s, h) => s + holdingBase(h, usdInr), 0);
  const equityPct = pct(equityBase, brief.totalAssets);
  const top10Value = brief.concentration.topHoldings.reduce((s, h) => s + h.value, 0);
  const top10Pct = pct(top10Value, brief.totalAssets);
  const top10Count = brief.concentration.topHoldings.length;

  // Top-holdings table: club the same instrument across accounts (default) or list per-account.
  const [byInstrument, setByInstrument] = useState(true);
  const assetHoldings = useMemo(() => view.holdings.filter((h) => {
    const t = acctById.get(h.accountId)?.accountType;
    return t !== "liability" && t !== "income";
  }), [view.holdings, acctById]);
  const clubbed = useMemo(() => groupHoldings(assetHoldings, view.accounts, usdInr), [assetHoldings, view.accounts, usdInr]);
  const perAccount = useMemo(
    () => [...assetHoldings].map((h) => ({ h, a: acctById.get(h.accountId), value: holdingBase(h, usdInr) })).sort((x, y) => y.value - x.value).slice(0, 10),
    [assetHoldings, acctById, usdInr],
  );
  const topRows = byInstrument
    ? clubbed.slice(0, 10).map((g) => ({ name: g.name, ticker: tickerOf(g.symbol, g.assetClass), cls: ASSET_CLASS_LABEL[g.assetClass], acct: g.accounts.join(" · "), value: g.value, pctOfAssets: pct(g.value, brief.totalAssets), legs: g.legs, fkey: g.key }))
    : perAccount.map(({ h, a, value }) => ({ name: h.name, ticker: tickerOf(h.symbol, h.assetClass), cls: ASSET_CLASS_LABEL[h.assetClass], acct: a?.name ?? "—", value, pctOfAssets: pct(value, brief.totalAssets), legs: 1, fkey: `id:${h.id}` }));
  const topRowsValue = topRows.reduce((s, r) => s + r.value, 0);
  const topRowsPct = pct(topRowsValue, brief.totalAssets);
  // One-glance health read, built from the same three verdicts shown in the cards below.
  const health = portfolioHealth({ equityPct, top10Pct, liquidPct: brief.liquidPct });
  // Investable corpus for the (optional) retirement projection: net worth excluding property,
  // since you can't fund a safe-withdrawal income off a house you live in.
  const realEstateBase = view.holdings.filter((h) => h.assetClass === "real_estate").reduce((s, h) => s + holdingBase(h, usdInr), 0);
  const investableCorpus = Math.max(0, brief.totalAssets - brief.totalLiabilities - realEstateBase);

  // Yesterday-vs-today (recorded snapshots of the visible accounts) for the hero delta.
  const delta = useMemo(() => {
    const pts = snapshotSeries(portfolio.snapshots ?? [], new Set(view.accounts.map((a) => a.id)));
    if (pts.length < 2) return null;
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    return { abs: last.netWorth - prev.netWorth, since: fmtDay(prev.t) };
  }, [portfolio.snapshots, view.accounts]);

  const animatedNetWorth = useCountUp(brief.netWorth);

  if (portfolio.accounts.length === 0) {
    return (
      <div className="card card-pad-lg" style={{ textAlign: "center", padding: "3rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>No data yet</div>
        <p className="muted" style={{ maxWidth: 420, margin: "0.5rem auto 0" }}>
          Go to <strong>Holdings</strong> to import a statement or enter accounts manually —
          or load the demo portfolio to explore.
        </p>
      </div>
    );
  }

  return (
    <div className="grid stagger" style={{ gap: "1rem" }}>
      {/* Metrics Row: Net Worth + (Optional) Health Score */}
      <div className="grid" style={{ gridTemplateColumns: portfolio.settings.insights?.healthScore ? "repeat(auto-fit, minmax(min(380px, 100%), 1fr))" : "1fr", gap: "1rem" }}>
        {/* The one number they open the app for — given a real moment. */}
        <div className="card card-pad-lg hero-card" style={{ padding: "1.25rem 1.4rem" }}>
          <div className="eyebrow">Net worth</div>
          <div className="hero-figure" style={{ fontSize: "2.4rem" }}>{fmtMoney(Math.round(animatedNetWorth))}</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
            {delta ? (
              <span className={`delta-chip ${delta.abs > 0 ? "up" : delta.abs < 0 ? "down" : "flat"}`} style={{ padding: "0.2rem 0.6rem", fontSize: "0.78rem" }}>
                {delta.abs > 0 ? "▲" : delta.abs < 0 ? "▼" : "•"}{" "}
                {`${delta.abs >= 0 ? "+" : "−"}${fmtMoney(Math.abs(delta.abs))}`} since {delta.since}
              </span>
            ) : (
              <span className="delta-chip flat" style={{ padding: "0.2rem 0.6rem", fontSize: "0.78rem" }}>Day one — history starts now</span>
            )}
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              {fmtMoney(brief.totalAssets)} owned · {fmtMoney(brief.totalLiabilities)} debt
            </span>
          </div>
        </div>

        {/* One-glance health read — OPTIONAL (Settings → Insights). Summarises the three cards below. */}
        {portfolio.settings.insights?.healthScore && (
          <div className="card" style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1.25rem 1.4rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.3rem" }}>
              <span className="hero-figure" style={{ fontSize: "2.2rem" }}>{health.score}</span>
              <span className="muted" style={{ fontSize: "0.85rem" }}>/ 100</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow">Portfolio health · {health.band.label}</div>
              <div className={`verdict ${health.band.tone}`} style={{ marginTop: "0.1rem", fontSize: "0.78rem" }}>
                <span className="dot" /> Risk, concentration & liquidity.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: "1rem" }}>
        <StatCard label="In the stock market" value={`${equityPct}%`}
          sub={`${fmtMoney(equityBase)} in equity`} verdict={equityVerdict(equityPct)} />
        <StatCard label="Easy to reach (liquid)" value={fmtMoney(brief.liquidAssets)}
          sub={`${brief.liquidPct}% liquid`} verdict={liquidityVerdict(brief.liquidPct)} />
        <StatCard label="Eggs in one basket" value={`${top10Pct}%`}
          sub={`in your top ${top10Count} holding${top10Count === 1 ? "" : "s"}`} verdict={concentrationVerdict(top10Pct)} />
      </div>

      {/* Net worth over time — recorded history, honors the account selection (Manage tab) */}
      <NetWorthTrend />

      {view.holdings.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "1.5rem" }}>
          <span className="muted">All accounts are excluded — re-include one on the <strong>Manage</strong> tab to see allocations and holdings.</span>
        </div>
      ) : (<>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1rem" }}>
          <div>
            <div className="eyebrow">Allocation</div>
            <h2 style={{ fontSize: "1.3rem", marginTop: "0.15rem" }}>Where your money sits</h2>
            {by === "asset_class" && (
              <p className="muted" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0" }}>
                Six broad groups — the table below breaks out every category.
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {DIMENSIONS.map((d) => (
              <button key={d.key} className={`chip ${by === d.key ? "active" : ""}`}
                onClick={() => { setBy(d.key); setExpanded(new Set()); }}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        {by === "asset_class" ? (
          <Donut segments={buckets.segments} total={buckets.total} onSelect={(k) => { if (k) toggleBucket(k); }} />
        ) : (
          <Donut segments={segments} total={total} onSelect={(k) => { if (k) toggleGroup(k); }} />
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.4rem" }}>
          <h2 style={{ fontSize: "1.15rem" }}>By {dimLabel.toLowerCase()}</h2>
          <button className="btn btn-ghost" style={{ fontSize: "0.78rem" }}
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(segments.map((s) => s.key)))}>
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.5rem" }}>
          Click a row (or a slice of the chart above) to see the holdings inside it.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{dimLabel} / holding</th>
                <th className="num">Value</th><th className="num">% assets</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => {
                const items = grouped.get(s.key) ?? [];
                const open = expanded.has(s.key);
                return (
                  <Fragment key={s.key}>
                    <tr
                      onClick={() => toggleGroup(s.key)}
                      tabIndex={0}
                      role="button"
                      aria-expanded={open}
                      aria-label={`${s.label}, ${s.percent}% — ${open ? "hide" : "show"} holdings`}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(s.key); } }}
                      style={{ cursor: "pointer", borderTop: "1px solid var(--line-2)" }}
                    >
                      <td style={{ fontWeight: 700 }}>
                        <span style={{ display: "inline-block", width: "1.1em", color: "var(--ink-2, #888)" }}>{open ? "▾" : "▸"}</span>
                        {s.label}
                        <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}> · {items.length} holding{items.length === 1 ? "" : "s"}</span>
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmtMoney(s.value)}</td>
                      <td className="num muted">{s.percent}%</td>
                    </tr>
                    {open && items.map(({ h, a, base }) => (
                      <tr key={h.id}>
                        <td style={{ paddingLeft: "1.9rem" }}>
                          <span style={{ fontWeight: 500 }}>{h.name}</span>
                          {h.currency !== "INR" && <span className="muted" style={{ fontSize: "0.78rem" }}> · {h.currency}</span>}
                          <span className="muted" style={{ fontSize: "0.78rem" }}> · {a?.name}</span>
                          {by !== "asset_class" && <span className="badge badge-gray" style={{ marginLeft: "0.4rem" }}>{ASSET_CLASS_LABEL[h.assetClass]}</span>}
                        </td>
                        <td className="num">{fmtMoney(base)}</td>
                        <td className="num muted">{pct(base, brief.totalAssets)}%</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top holdings — the names behind the concentration widget (no expand/collapse) */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <div>
            <div className="eyebrow">Concentration</div>
            <h2 style={{ fontSize: "1.3rem", marginTop: "0.15rem" }}>Your {topRows.length} biggest holding{topRows.length === 1 ? "" : "s"}</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              <button className={`chip ${byInstrument ? "active" : ""}`} style={{ padding: "0.12rem 0.55rem", fontSize: "0.74rem" }} onClick={() => setByInstrument(true)}>By instrument</button>
              <button className={`chip ${!byInstrument ? "active" : ""}`} style={{ padding: "0.12rem 0.55rem", fontSize: "0.74rem" }} onClick={() => setByInstrument(false)}>By account</button>
            </div>
            <span className="muted" style={{ fontSize: "0.8rem" }}>{topRowsPct}% of everything you own</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: "1.5rem" }}>#</th>
                <th>Holding</th><th>Type</th><th>{byInstrument ? "Account(s)" : "Account"}</th>
                <th className="num">Value</th><th className="num">% assets</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((h, i) => (
                <tr key={i} data-focus-key={h.fkey} style={{ borderTop: "1px solid var(--line-2)" }}>
                  <td className="muted num">{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{h.name}{h.ticker && <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}> ({h.ticker})</span>}</td>
                  <td><span className="badge badge-gray">{h.cls}</span></td>
                  <td className="muted" style={{ fontSize: "0.84rem" }}>
                    {h.acct}
                    {h.legs > 1 && <span className="badge badge-gray" style={{ marginLeft: "0.35rem", fontSize: "0.66rem" }}>{h.legs} accounts</span>}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtMoney(h.value)}</td>
                  <td className="num muted">{h.pctOfAssets}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Optional retirement outlook (Settings → Insights → Goals & retirement). */}
      {portfolio.settings.insights?.goals && <Goals currentCorpus={investableCorpus} />}

      </>)}
    </div>
  );
}
