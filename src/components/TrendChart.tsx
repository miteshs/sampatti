// Shared area/line chart for the two trend cards. Visual language: SOLID = recorded fact
// (Overview's daily net-worth record), DASHED = simulation (Performance's back-priced
// market history). Keeping the styling in one place keeps that distinction consistent.

import type { NetWorthPoint } from "../domain/history";

export function TrendChart({ points, simulated }: { points: NetWorthPoint[]; simulated?: boolean }) {
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
      {last && <circle cx={x(last.t)} cy={y(last.netWorth)} r="3.2" fill={stroke} />}
    </svg>
  );
}
