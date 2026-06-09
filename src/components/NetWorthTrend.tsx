// Net-worth-over-time card (Overview) — the RECORDED history only. The store writes a
// per-account snapshot into portfolio.json every day the app sees data (imports, edits,
// price refreshes and FX changes all land in that day's record), so this curve is fact:
// no simulation, no back-pricing. The market-data what-if lives on the Performance tab
// (MarketHistory). Honors the account include/exclude selection at render time.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio } from "../domain/types";
import { PERIODS, periodChange, periodStart, type Period } from "../domain/history";
import { snapshotSeries } from "../domain/snapshots";
import { inr } from "../domain/format";
import { TrendChart } from "./TrendChart";

export function NetWorthTrend() {
  const portfolio = useStore((s) => s.portfolio);
  const visible = useMemo(() => visiblePortfolio(portfolio), [portfolio]);
  const [period, setPeriod] = useState<Period>("1Y");

  const recordedDays = (portfolio.snapshots ?? []).length;
  const points = useMemo(
    () => snapshotSeries(portfolio.snapshots ?? [], new Set(visible.accounts.map((a) => a.id)), periodStart(period)),
    [portfolio.snapshots, visible.accounts, period],
  );
  const change = useMemo(() => periodChange(points), [points]);

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
            {PERIODS.map((p) => (
              <button key={p} className={`chip ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {!haveChart ? (
        <p className="muted" style={{ fontSize: "0.84rem", maxWidth: 580, marginTop: "0.8rem", marginBottom: 0 }}>
          Sampatti records your net worth automatically every day you open it —{" "}
          <strong>{recordedDays} day{recordedDays === 1 ? "" : "s"} on file</strong>
          {first ? ` (since ${first})` : ""}. Your real history builds from here: imports, edits,
          live-price refreshes and FX changes all land in the daily record. Until it accumulates,
          the <strong>Performance</strong> tab can simulate the past year from market data.
        </p>
      ) : (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 750, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{inr(points[points.length - 1].netWorth)}</div>
            <div style={{ fontWeight: 700, color: change.abs >= 0 ? "#1a9e6b" : "#d6455d" }}>
              {change.abs >= 0 ? "▲" : "▼"} {inr(Math.abs(change.abs))}{change.pct != null ? ` · ${change.pct >= 0 ? "+" : ""}${change.pct}%` : ""}
              <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}> over {period}</span>
            </div>
          </div>
          <TrendChart points={points} />
          <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.5rem" }}>
            — Recorded daily as you use the app · {recordedDays} day{recordedDays === 1 ? "" : "s"} on file
            {first ? ` since ${first}` : ""}. This is your actual history (growth + money added together);
            it honors the account selection on Manage.
          </p>
        </div>
      )}
    </div>
  );
}
