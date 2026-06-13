// Net-worth-over-time card (Overview) — the RECORDED history only. The store writes a
// per-account snapshot into portfolio.json every day the app sees data (imports, edits,
// price refreshes and FX changes all land in that day's record), so this curve is fact:
// no simulation, no back-pricing. The per-account breakdown of the same record lives on
// the Performance tab (AccountStack). Honors the account selection at render time.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio } from "../domain/types";
import { PERIODS, periodChange, periodStart, type Period } from "../domain/history";
import { pointsInWindow, snapshotSeries, snapshotTime } from "../domain/snapshots";
import { flowsInWindow, incomeOverWindow } from "../domain/flows";
import { fmtMoney } from "../regions/profile";
import { TrendChart } from "./TrendChart";

const GREEN = "var(--up-ink)", RED = "var(--down-ink)"; // theme tokens (light/dark, text-grade ≥4.5:1)
const signedInr = (n: number) => `${n >= 0 ? "+" : "−"}${fmtMoney(Math.abs(n))}`;

export function NetWorthTrend() {
  const portfolio = useStore((s) => s.portfolio);
  const visible = useMemo(() => visiblePortfolio(portfolio), [portfolio]);
  const [period, setPeriod] = useState<Period>("1Y");
  // Drag-selected window (brush zoom) — cleared by the ✕ chip, double-click, or any period.
  const [zoom, setZoom] = useState<{ from: number; to: number } | null>(null);

  const recordedDays = (portfolio.snapshots ?? []).length;
  const points = useMemo(() => {
    const all = snapshotSeries(portfolio.snapshots ?? [], new Set(visible.accounts.map((a) => a.id)), periodStart(period));
    if (zoom) {
      const sliced = pointsInWindow(all, zoom.from, zoom.to);
      if (sliced.length >= 3) return sliced;
    }
    return all;
  }, [portfolio.snapshots, visible.accounts, period, zoom]);
  const change = useMemo(() => periodChange(points), [points]);

  // Why did it change? flows/tracking/unclassified come from the ledger; growth is the
  // residual — so the three lines always sum exactly to the recorded change.
  const split = useMemo(() => {
    if (points.length < 2) return null;
    const fromT = points[0].t, toT = points[points.length - 1].t;
    const f = flowsInWindow(portfolio.flows ?? [], new Set(visible.accounts.map((a) => a.id)), fromT, toT, snapshotTime);
    const growth = change.abs - f.flow - f.tracking - f.unclassified;
    const days = Math.max(1, Math.round((toT - fromT) / 86_400_000));
    const income = incomeOverWindow(portfolio.income, days, portfolio.settings.usdInr);
    const savingsRate = f.flow > 0 && income > 0 ? Math.round((f.flow / income) * 100) : null;
    return { ...f, growth, savingsRate };
  }, [points, change.abs, portfolio.flows, portfolio.income, portfolio.settings.usdInr, visible.accounts]);

  const anyFlows = !!split && (split.flow !== 0 || split.tracking !== 0 || split.unclassified !== 0);

  if (portfolio.holdings.length === 0) return null;

  const haveChart = points.length >= 2;
  const first = (portfolio.snapshots ?? [])[0]?.date;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <div className="eyebrow">Net worth over time · recorded</div>
          <h2 style={{ fontSize: "1.15rem", marginTop: "0.15rem" }}>Your net worth, day by day</h2>
        </div>
        {haveChart && (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
            {zoom && (
              <button className="chip active" onClick={() => setZoom(null)} title="Back to the full period">
                ✕ Custom range
              </button>
            )}
            {PERIODS.map((p) => (
              <button key={p} className={`chip ${!zoom && period === p ? "active" : ""}`}
                onClick={() => { setPeriod(p); setZoom(null); }}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {!haveChart ? (
        <p className="muted" style={{ fontSize: "0.84rem", maxWidth: 580, marginTop: "0.8rem", marginBottom: 0 }}>
          Sampatti records your net worth automatically every day you open it —{" "}
          <strong>{recordedDays} day{recordedDays === 1 ? "" : "s"} on file</strong>
          {first ? ` (since ${first})` : ""}. Your real history builds from here: imports, edits,
          live-price refreshes and FX changes all land in the daily record. Meanwhile the{" "}
          <strong>Performance</strong> tab's <em>All</em> view already reaches back through your
          purchase costs, account by account.
        </p>
      ) : (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 750, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(points[points.length - 1].netWorth)}</div>
            <div style={{ fontWeight: 700, color: change.abs >= 0 ? GREEN : RED }}>
              {change.abs >= 0 ? "▲" : "▼"} {fmtMoney(Math.abs(change.abs))}{change.pct != null ? ` · ${change.pct >= 0 ? "+" : ""}${change.pct}%` : ""}
              <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}> over {zoom ? "the selected range" : period}</span>
            </div>
          </div>
          <TrendChart points={points} onBrush={(from, to) => setZoom({ from, to })} onResetZoom={() => setZoom(null)} />
          {anyFlows && split && (
            <div style={{ marginTop: "0.6rem", padding: "0.55rem 0.8rem", background: "var(--surface-2)", borderRadius: "10px", fontSize: "0.84rem", display: "flex", gap: "1.1rem", flexWrap: "wrap", alignItems: "baseline" }}>
              <span>
                <span className="muted" style={{ fontSize: "0.72rem" }}>market growth </span>
                <strong style={{ color: split.growth >= 0 ? GREEN : RED, fontVariantNumeric: "tabular-nums" }}>{signedInr(split.growth)}</strong>
              </span>
              {split.flow !== 0 && (
                <span>
                  <span className="muted" style={{ fontSize: "0.72rem" }}>{split.flow >= 0 ? "money added " : "money withdrawn "}</span>
                  <strong style={{ fontVariantNumeric: "tabular-nums" }}>{signedInr(split.flow)}</strong>
                  {split.savingsRate != null && <span className="muted" style={{ fontSize: "0.74rem" }}> · ≈{split.savingsRate}% of your income</span>}
                </span>
              )}
              {split.tracking !== 0 && (
                <span>
                  <span className="muted" style={{ fontSize: "0.72rem" }}>tracking changes </span>
                  <strong style={{ fontVariantNumeric: "tabular-nums" }}>{signedInr(split.tracking)}</strong>
                  <span className="muted" style={{ fontSize: "0.74rem" }}> (assets you started/stopped tracking — not savings, not growth)</span>
                </span>
              )}
              {split.unclassified !== 0 && (
                <span>
                  <span className="muted" style={{ fontSize: "0.72rem" }}>unclassified </span>
                  <strong style={{ fontVariantNumeric: "tabular-nums" }}>{signedInr(split.unclassified)}</strong>
                </span>
              )}
            </div>
          )}
          <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.5rem" }}>
            — Recorded daily as you use the app · {recordedDays} day{recordedDays === 1 ? "" : "s"} on file
            {first ? ` since ${first}` : ""}. {anyFlows
              ? "Growth is what your investments did on their own; statement re-imports split bought/sold from price moves automatically (manual revaluations count as growth)."
              : "This is your actual history; re-import statements and the change splits into growth vs money added."} Honors the account selection on Manage.
          </p>
        </div>
      )}
    </div>
  );
}
