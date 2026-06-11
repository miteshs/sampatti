// "Your portfolio, account by account" — Performance tab. A stacked area chart of the
// RECORDED daily snapshots, one band per account, so the eye reads both the total and who
// is carrying it. Assets only (a loan doesn't "perform"); newly added accounts rise out of
// the baseline on the day they were added. No simulation anywhere — this is the record.

import { useMemo, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio } from "../domain/types";
import { PERIODS, periodStart, type Period } from "../domain/history";
import { perAccountSeries } from "../domain/snapshots";
import { basisBandsByAccount, basisSampleTimes } from "../domain/basisHistory";
import { inr } from "../domain/format";
import { color } from "./ui";
import { TimeAxis } from "./timeAxis";
import { useBrush } from "./useBrush";

const MAX_BANDS = 8; // beyond this, small accounts roll into "Other accounts"

// Slice the assembled chart data to a dragged time window. Pure + exported for tests.
// Returns null when the window covers fewer than 3 points (nothing meaningful to zoom to).
export function zoomSlice<B extends { values: number[] }>(
  times: number[],
  bands: B[],
  splitIndex: number,
  from: number,
  to: number,
): { times: number[]; bands: B[]; splitIndex: number } | null {
  const i0 = times.findIndex((t) => t >= from);
  let i1 = -1;
  for (let i = times.length - 1; i >= 0; i--) if (times[i] <= to) { i1 = i; break; }
  if (i0 < 0 || i1 - i0 < 2) return null;
  return {
    times: times.slice(i0, i1 + 1),
    bands: bands.map((b) => ({ ...b, values: b.values.slice(i0, i1 + 1) })),
    // Keep the estimated/recorded boundary honest inside the slice: ≤0 = all recorded,
    // ≥ length = the whole slice is the estimated era.
    splitIndex: Math.max(0, Math.min(splitIndex - i0, i1 - i0 + 1)),
  };
}

export function AccountStack() {
  const portfolio = useStore((s) => s.portfolio);
  const visible = useMemo(() => visiblePortfolio(portfolio), [portfolio]);
  const [period, setPeriod] = useState<Period>("All"); // the stack's job is the whole story
  const [hover, setHover] = useState<string | null>(null);
  // Drag-selected time window (brush zoom) — cleared by the ✕ chip, double-click, or
  // picking any period.
  const [zoom, setZoom] = useState<{ from: number; to: number } | null>(null);

  const data = useMemo(() => {
    // Assets only — liability accounts are excluded from a performance stack.
    const assetIds = new Set(visible.accounts.filter((a) => a.accountType !== "liability").map((a) => a.id));
    const { times, series } = perAccountSeries(portfolio.snapshots ?? [], assetIds, periodStart(period));
    if (times.length < 2) return null;

    // On "All" only: reach back beyond the record using purchase costs — each real-basis
    // holding anchors at (buyDate, cost) and compounds toward today. Drawn lighter, with a
    // divider where the actual daily record begins. Basis-less holdings join at the divider.
    let preTimes: number[] = [];
    const preByAccount = new Map<string, number[]>();
    if (period === "All") {
      const assetHoldings = visible.holdings.filter((h) => assetIds.has(h.accountId));
      preTimes = basisSampleTimes(assetHoldings, times[0]);
      if (preTimes.length > 0) {
        for (const b of basisBandsByAccount(assetHoldings, assetIds, portfolio.settings.usdInr, preTimes)) {
          preByAccount.set(b.accountId, b.values);
        }
      }
    }
    const zerosPre = preTimes.map(() => 0);
    const allTimes = [...preTimes, ...times];

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
      values: [...(preByAccount.get(s.accountId) ?? zerosPre), ...s.values],
    }));
    if (rest.length > 0) {
      bands.push({
        key: "__other",
        name: `Other accounts (${rest.length})`,
        color: "#b3ae9f",
        values: [
          ...preTimes.map((_, ti) => rest.reduce((sum, s) => sum + (preByAccount.get(s.accountId)?.[ti] ?? 0), 0)),
          ...times.map((_, di) => rest.reduce((sum, s) => sum + s.values[di], 0)),
        ],
      });
    }
    if (zoom) {
      const sliced = zoomSlice(allTimes, bands, preTimes.length, zoom.from, zoom.to);
      // Accounts that are zero across the zoomed window (not tracked yet then) drop out;
      // colors were assigned before slicing, so each account keeps its color across zooms.
      if (sliced) return { ...sliced, bands: sliced.bands.filter((b) => b.values.some((v) => v !== 0)) };
    }
    return { times: allTimes, bands, splitIndex: preTimes.length };
  }, [portfolio.snapshots, visible.accounts, visible.holdings, portfolio.settings.usdInr, period, zoom]);

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

      {!data ? (
        <p className="muted" style={{ fontSize: "0.84rem", marginTop: "0.8rem", maxWidth: 540 }}>
          This chart draws itself from the daily record — open the app on a second day and the
          stack appears, one colored band per account.
        </p>
      ) : (
        <div style={{ marginTop: "0.8rem" }}>
          <StackSvg
            times={data.times} bands={data.bands} hover={hover} splitIndex={data.splitIndex}
            onBrush={(from, to) => setZoom({ from, to })}
            onResetZoom={() => setZoom(null)}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 1.1rem", marginTop: "0.6rem" }}>
            {data.bands.map((b) => {
              const first = b.values[0], last = b.values[b.values.length - 1];
              const delta = last - first;
              // A band that starts at 0 JOINED mid-window — its "change" is not a gain,
              // so show when it entered the chart instead of a green number.
              const joinedIdx = first === 0 ? b.values.findIndex((v) => v !== 0) : -1;
              const joined = joinedIdx > 0
                ? new Date(data.times[joinedIdx]).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
                : null;
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
                  {joined ? (
                    <span className="muted" style={{ fontSize: "0.74rem" }}>from {joined.replace(" ", " ’")}</span>
                  ) : delta !== 0 ? (
                    <span style={{ fontSize: "0.74rem", fontVariantNumeric: "tabular-nums", color: delta > 0 ? "#19724f" : "var(--down)" }}>
                      {delta > 0 ? "+" : "−"}{inr(Math.abs(delta))}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.55rem", marginBottom: 0 }}>
            {data.splitIndex > 0 && (
              <>Left of the dotted divider the bands are <strong>estimated from purchase costs</strong>
              {" "}(lighter — each holding starts at what you paid and compounds to today; holdings
              without a cost basis join at the divider). Right of it is the daily record. </>
            )}
            Assets only (loans aren't shown); an account added along the way rises out of the
            baseline on its add-day. Each legend figure is the account's value at the end of the
            window shown, with its change across it. <strong>Drag across the chart to zoom into
            any range</strong> — double-click (or ✕ Custom range) to zoom back out. Honors the
            account selection on Manage.
          </p>
        </div>
      )}
    </div>
  );
}

function StackSvg({ times, bands, hover, splitIndex = 0, onBrush, onResetZoom }: {
  times: number[];
  bands: { key: string; name: string; color: string; values: number[] }[];
  hover: string | null;
  splitIndex?: number; // first index of the RECORDED era; >0 means an estimated era precedes it
  onBrush?: (from: number, to: number) => void;
  onResetZoom?: () => void;
}) {
  const W = 720, H = 200, PAD = 6;
  const n = times.length;
  const svgRef = useRef<SVGSVGElement>(null);

  // Cumulative stack, drawn bottom-up: band i fills between cum(i-1) and cum(i).
  const totals = times.map((_, di) => bands.reduce((s, b) => s + b.values[di], 0));
  const maxY = Math.max(...totals, 1);
  const minX = times[0], spanX = times[n - 1] - times[0] || 1;
  const x = (t: number) => PAD + ((t - minX) / spanX) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);

  // Pointer position → time, via the rendered element's box (the SVG scales with width).
  const timeAt = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return minX;
    const xView = ((clientX - rect.left) / rect.width) * W;
    const frac = Math.min(1, Math.max(0, (xView - PAD) / (W - 2 * PAD)));
    return minX + frac * spanX;
  };
  const { drag, handlers } = useBrush(timeAt, onBrush);

  // An area path over an index range [from, to] inclusive.
  const areaOf = (lower: number[], upper: number[], from: number, to: number) => {
    const fwd: string[] = [], back: string[] = [];
    for (let i = from; i <= to; i++) fwd.push(`${i === from ? "M" : "L"}${x(times[i]).toFixed(1)},${y(upper[i]).toFixed(1)}`);
    for (let i = to; i >= from; i--) back.push(`L${x(times[i]).toFixed(1)},${y(lower[i]).toFixed(1)}`);
    return `${fwd.join(" ")} ${back.join(" ")} Z`;
  };

  let cum = times.map(() => 0);
  const layers = bands.map((b) => {
    const lower = cum;
    const upper = cum.map((v, di) => v + b.values[di]);
    cum = upper;
    const segs: { d: string; estimated: boolean }[] = [];
    if (splitIndex >= n) {
      segs.push({ d: areaOf(lower, upper, 0, n - 1), estimated: true }); // zoomed fully into the estimated era
    } else if (splitIndex > 0) {
      segs.push({ d: areaOf(lower, upper, 0, splitIndex), estimated: true });
      segs.push({ d: areaOf(lower, upper, splitIndex, n - 1), estimated: false });
    } else {
      segs.push({ d: areaOf(lower, upper, 0, n - 1), estimated: false });
    }
    return { key: b.key, color: b.color, segs };
  });

  const baseOpacity = (k: string) => (hover == null ? 0.82 : hover === k ? 0.95 : 0.25);

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: onBrush ? "crosshair" : "default", touchAction: "none" }}
        preserveAspectRatio="none"
        {...handlers}
        onDoubleClick={() => onResetZoom?.()}
      >
        {layers.map((l) =>
          l.segs.map((s, i) => (
            <path
              key={`${l.key}-${i}`} d={s.d} fill={l.color} stroke="#ffffff" strokeWidth="0.6"
              fillOpacity={baseOpacity(l.key) * (s.estimated ? 0.45 : 1)}
              style={{ transition: "fill-opacity 0.15s ease" }}
            />
          )),
        )}
        {splitIndex > 0 && splitIndex < n && (
          <line
            x1={x(times[splitIndex])} x2={x(times[splitIndex])} y1={PAD} y2={H - PAD}
            stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 4" strokeOpacity="0.7"
          />
        )}
        {drag && Math.abs(drag.b - drag.a) > 0 && (
          <rect
            x={Math.min(x(drag.a), x(drag.b))} y={PAD}
            width={Math.abs(x(drag.b) - x(drag.a))} height={H - 2 * PAD}
            fill="var(--primary)" fillOpacity="0.12"
            stroke="var(--primary)" strokeWidth="1" strokeDasharray="4 3"
          />
        )}
      </svg>
      <TimeAxis minT={times[0]} maxT={times[n - 1]} pad={PAD} width={W} />
    </div>
  );
}
