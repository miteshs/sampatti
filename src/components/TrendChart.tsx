// Area/line chart for the Overview trend card — the RECORDED daily net-worth curve.
// Solid line = fact: this app charts only what actually happened (the old market
// simulation was removed as confusing; the per-account view lives in AccountStack).

import { useRef } from "react";
import type { NetWorthPoint } from "../domain/history";
import { TimeAxis } from "./timeAxis";
import { useBrush } from "./useBrush";

export function TrendChart({ points, onBrush, onResetZoom }: {
  points: NetWorthPoint[];
  onBrush?: (from: number, to: number) => void;
  onResetZoom?: () => void;
}) {
  const W = 720, H = 180, PAD = 6;
  const svgRef = useRef<SVGSVGElement>(null);
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.netWorth);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || Math.abs(maxY) || 1;
  const x = (t: number) => PAD + ((t - minX) / spanX) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - minY) / spanY) * (H - 2 * PAD);

  const timeAt = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return minX;
    const xView = ((clientX - rect.left) / rect.width) * W;
    const frac = Math.min(1, Math.max(0, (xView - PAD) / (W - 2 * PAD)));
    return minX + frac * spanX;
  };
  const { drag, handlers } = useBrush(timeAt, onBrush);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxX).toFixed(1)},${H - PAD} L${x(minX).toFixed(1)},${H - PAD} Z`;
  const up = ys[ys.length - 1] >= ys[0];
  const stroke = up ? "var(--up)" : "var(--down)"; // theme tokens (graphic-grade) — adapt to dark
  const last = points[points.length - 1];
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
        <defs>
          <linearGradient id="trendfill-rec" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trendfill-rec)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {last && <circle cx={x(last.t)} cy={y(last.netWorth)} r="3.2" fill={stroke} />}
        {drag && Math.abs(drag.b - drag.a) > 0 && (
          <rect
            x={Math.min(x(drag.a), x(drag.b))} y={PAD}
            width={Math.abs(x(drag.b) - x(drag.a))} height={H - 2 * PAD}
            fill="var(--primary)" fillOpacity="0.12"
            stroke="var(--primary)" strokeWidth="1" strokeDasharray="4 3"
          />
        )}
      </svg>
      <TimeAxis minT={minX} maxT={maxX} pad={PAD} width={W} />
    </div>
  );
}
