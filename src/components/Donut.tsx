import { useState } from "react";
import type { Segment } from "../domain/group";
import { pct } from "../domain/format";
import { fmtMoney } from "../regions/profile";
import { color } from "./ui";

// A clean SVG donut with a center total and a hover-to-highlight legend.
export function Donut({ segments, total, onSelect }: {
  segments: Segment[];
  total: number;
  onSelect?: (key: string | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const R = 90, r = 60, C = 120;
  const circ = 2 * Math.PI * ((R + r) / 2);
  const width = R - r;
  let offset = 0;
  // Semantic colors when the segments carry them (bucket view); palette rotation otherwise.
  const colorFor = (i: number) => segments[i].color ?? color(i);

  return (
    <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <svg width={C * 2} height={C * 2} viewBox={`0 0 ${C * 2} ${C * 2}`} style={{ flexShrink: 0 }}>
        <g transform={`rotate(-90 ${C} ${C})`}>
          {segments.map((s, i) => {
            const frac = total ? s.value / total : 0;
            const len = frac * circ;
            const dash = `${len} ${circ - len}`;
            const el = (
              <circle
                key={s.key}
                cx={C} cy={C} r={(R + r) / 2}
                fill="none"
                stroke={colorFor(i)}
                strokeWidth={hover === i ? width + 6 : width}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                style={{ transition: "stroke-width 0.15s ease", cursor: onSelect ? "pointer" : "default" }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(s.key)}
              />
            );
            offset += len;
            return el;
          })}
        </g>
        <text x={C} y={C - 6} textAnchor="middle" fontSize="13" fill="var(--ink-3)" fontWeight={600}>
          {hover != null ? segments[hover].label : "Total"}
        </text>
        <text x={C} y={C + 18} textAnchor="middle" fontSize="20" fill="var(--ink)" fontWeight={800}>
          {hover != null ? fmtMoney(segments[hover].value) : fmtMoney(total)}
        </text>
        {hover != null && (
          <text x={C} y={C + 38} textAnchor="middle" fontSize="12" fill="var(--ink-3)">
            {pct(segments[hover].value, total)}%
          </text>
        )}
      </svg>

      <div style={{ flex: 1, minWidth: 240 }}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect?.(s.key)}
            style={{
              display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.32rem 0.4rem",
              borderRadius: 8, cursor: onSelect ? "pointer" : "default",
              background: hover === i ? "var(--line-2)" : "transparent",
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: colorFor(i), flexShrink: 0 }} />
            <span style={{ fontSize: "0.85rem", color: "var(--ink)", flex: 1 }}>{s.label}</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {fmtMoney(s.value)}
            </span>
            <span style={{ fontSize: "0.78rem", color: "var(--ink-3)", width: 46, textAlign: "right" }}>
              {pct(s.value, total)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
