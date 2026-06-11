// "Your portfolio, account by account" — Performance tab. A stacked area chart of the
// RECORDED daily snapshots, one band per account, so the eye reads both the total and who
// is carrying it. Assets only (a loan doesn't "perform"); newly added accounts rise out of
// the baseline on the day they were added. No simulation anywhere — this is the record.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio } from "../domain/types";
import { PERIODS, periodStart, type Period } from "../domain/history";
import { perAccountSeries } from "../domain/snapshots";
import { inr } from "../domain/format";
import { color } from "./ui";

const MAX_BANDS = 8; // beyond this, small accounts roll into "Other accounts"

export function AccountStack() {
  const portfolio = useStore((s) => s.portfolio);
  const visible = useMemo(() => visiblePortfolio(portfolio), [portfolio]);
  const [period, setPeriod] = useState<Period>("1Y");
  const [hover, setHover] = useState<string | null>(null);

  const data = useMemo(() => {
    // Assets only — liability accounts are excluded from a performance stack.
    const assetIds = new Set(visible.accounts.filter((a) => a.accountType !== "liability").map((a) => a.id));
    const { times, series } = perAccountSeries(portfolio.snapshots ?? [], assetIds, periodStart(period));
    if (times.length < 2) return null;

    // Big accounts get their own band (largest at the bottom — stable to read);
    // the tail rolls up into "Other accounts".
    const nameById = new Map(visible.accounts.map((a) => [a.id, a.name]));
    const ranked = [...series].sort((x, y) => y.values[y.values.length - 1] - x.values[x.values.length - 1]);
    const top = ranked.slice(0, MAX_BANDS);
    const rest = ranked.slice(MAX_BANDS);
    const bands = top.map((s, i) => ({
      key: s.accountId,
      name: nameById.get(s.accountId) ?? "—",
      color: color(i),
      values: s.values,
    }));
    if (rest.length > 0) {
      bands.push({
        key: "__other",
        name: `Other accounts (${rest.length})`,
        color: "#b3ae9f",
        values: times.map((_, di) => rest.reduce((sum, s) => sum + s.values[di], 0)),
      });
    }
    return { times, bands };
  }, [portfolio.snapshots, visible.accounts, period]);

  if ((portfolio.snapshots ?? []).length === 0 || visible.holdings.length === 0) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
        <div>
          <div className="eyebrow">Recorded · by account</div>
          <h2 style={{ fontSize: "1.3rem", marginTop: "0.15rem" }}>Your portfolio, account by account</h2>
        </div>
        {data && (
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {PERIODS.map((p) => (
              <button key={p} className={`chip ${period === p ? "active" : ""}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {!data ? (
        <p className="muted" style={{ fontSize: "0.84rem", marginTop: "0.8rem", maxWidth: 540 }}>
          This chart draws itself from the daily record — open the app on a second day and the
          stack appears, one colored band per account.
        </p>
      ) : (
        <div style={{ marginTop: "0.8rem" }}>
          <StackSvg times={data.times} bands={data.bands} hover={hover} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1.1rem", marginTop: "0.6rem" }}>
            {data.bands.map((b) => {
              const first = b.values[0], last = b.values[b.values.length - 1];
              const delta = last - first;
              return (
                <div
                  key={b.key}
                  onMouseEnter={() => setHover(b.key)}
                  onMouseLeave={() => setHover(null)}
                  style={{ display: "flex", alignItems: "baseline", gap: "0.4rem", fontSize: "0.8rem", cursor: "default", opacity: hover && hover !== b.key ? 0.45 : 1 }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: b.color, flexShrink: 0, transform: "translateY(1px)" }} />
                  <span style={{ fontWeight: 600 }}>{b.name}</span>
                  <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{inr(last)}</span>
                  {delta !== 0 && (
                    <span style={{ fontSize: "0.74rem", fontVariantNumeric: "tabular-nums", color: delta > 0 ? "#19724f" : "var(--down)" }}>
                      {delta > 0 ? "+" : "−"}{inr(Math.abs(delta))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.55rem", marginBottom: 0 }}>
            Stacked from your daily record — assets only (loans aren't shown). An account added
            along the way rises out of the baseline on the day you added it. Each legend figure is
            today's value, with its change over the window. Honors the account selection on Manage.
          </p>
        </div>
      )}
    </div>
  );
}

function StackSvg({ times, bands, hover }: {
  times: number[];
  bands: { key: string; name: string; color: string; values: number[] }[];
  hover: string | null;
}) {
  const W = 720, H = 200, PAD = 6;
  const n = times.length;
  // Cumulative stack, drawn bottom-up: band i fills between cum(i-1) and cum(i).
  const totals = times.map((_, di) => bands.reduce((s, b) => s + b.values[di], 0));
  const maxY = Math.max(...totals, 1);
  const minX = times[0], spanX = times[n - 1] - times[0] || 1;
  const x = (t: number) => PAD + ((t - minX) / spanX) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);

  let cum = times.map(() => 0);
  const areas = bands.map((b) => {
    const lower = cum;
    const upper = cum.map((v, di) => v + b.values[di]);
    cum = upper;
    const fwd = upper.map((v, di) => `${di ? "L" : "M"}${x(times[di]).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const back = [...lower].reverse().map((v, ri) => `L${x(times[n - 1 - ri]).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return { key: b.key, color: b.color, d: `${fwd} ${back} Z` };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none">
      {areas.map((a) => (
        <path
          key={a.key} d={a.d} fill={a.color} stroke="#ffffff" strokeWidth="0.6"
          fillOpacity={hover == null ? 0.82 : hover === a.key ? 0.95 : 0.25}
          style={{ transition: "fill-opacity 0.15s ease" }}
        />
      ))}
    </svg>
  );
}
