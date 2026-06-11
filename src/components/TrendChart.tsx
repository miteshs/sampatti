// Shared area/line chart for the trend cards. Visual language: SOLID = recorded fact
// (Overview's daily net-worth record), DASHED = simulation (Performance's back-priced
// market history). Performance can OVERLAY extra recorded lines on the simulation —
// everything shares one y-scale so the comparison is honest.

import type { NetWorthPoint } from "../domain/history";

export interface TrendOverlay {
  points: NetWorthPoint[];
  color: string;
  width?: number;
  opacity?: number;
}

export function TrendChart({ points, simulated, overlays }: {
  points: NetWorthPoint[];
  simulated?: boolean;
  overlays?: TrendOverlay[];
}) {
  const W = 720, H = 180, PAD = 6;
  const series = [points, ...(overlays ?? []).map((o) => o.points)].filter((s) => s.length > 0);
  const xs = series.flat().map((p) => p.t);
  const ys = series.flat().map((p) => p.netWorth);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || Math.abs(maxY) || 1;
  const x = (t: number) => PAD + ((t - minX) / spanX) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - minY) / spanY) * (H - 2 * PAD);
  const pathOf = (pts: NetWorthPoint[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");

  const line = pathOf(points);
  const area = `${line} L${x(points[points.length - 1].t).toFixed(1)},${H - PAD} L${x(points[0].t).toFixed(1)},${H - PAD} Z`;
  const up = points[points.length - 1].netWorth >= points[0].netWorth;
  const stroke = up ? "#1a9e6b" : "#d6455d";
  const gradId = simulated ? "trendfill-sim" : "trendfill-rec";
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={simulated ? 0.12 : 0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line} fill="none" stroke={stroke} strokeWidth={simulated ? 2 : 2.2}
        strokeDasharray={simulated ? "5 4" : undefined} strokeOpacity={simulated ? 0.75 : 1}
        strokeLinejoin="round" strokeLinecap="round"
      />
      {(overlays ?? []).filter((o) => o.points.length >= 2).map((o, i) => (
        <path
          key={i}
          d={pathOf(o.points)} fill="none" stroke={o.color} strokeWidth={o.width ?? 2.2}
          strokeOpacity={o.opacity ?? 1} strokeLinejoin="round" strokeLinecap="round"
        />
      ))}
      {last && <circle cx={x(last.t)} cy={y(last.netWorth)} r="3.2" fill={stroke} />}
    </svg>
  );
}
