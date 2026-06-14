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
  // Tap-to-pin: touch devices have no hover, so a tap pins a segment's center readout (and
  // highlight). Tapping it again unpins. Hover always wins while the pointer is over a slice.
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hover != null ? hover : pinned; // what the center readout + highlight reflect
  const R = 90, r = 60, C = 120;
  const circ = 2 * Math.PI * ((R + r) / 2);
  const width = R - r;
  let offset = 0;

  // Semantic colors when the segments carry them (bucket view); palette rotation otherwise.
  const colorFor = (i: number) => segments[i].color ?? color(i);
  const select = (i: number, key: string) => {
    setPinned((p) => (p === i ? null : i));
    onSelect?.(key);
  };

  return (
    <div style={{ display: "flex", gap: "2.5rem", flexWrap: "wrap", alignItems: "center", padding: "1rem 0" }}>
      <div style={{ position: "relative", width: C * 2, height: C * 2 }}>
        <svg width={C * 2} height={C * 2} viewBox={`0 0 ${C * 2} ${C * 2}`} style={{ flexShrink: 0, overflow: "visible" }}>
          <defs>
            <filter id="donutShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1" />
            </filter>
            <linearGradient id="oasisGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--primary)" />
              <stop offset="50%" stopColor="var(--amber)" />
              <stop offset="100%" stopColor="var(--emerald)" />
            </linearGradient>
          </defs>
          <g transform={`rotate(-90 ${C} ${C})`} filter="url(#donutShadow)">
            <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="var(--line-2)" strokeWidth={width - 4} />
            {segments.map((s, i) => {
              const frac = total ? s.value / total : 0;
              const len = frac * circ;
              const dash = `${Math.max(0, len - 2)} ${circ - (Math.max(0, len - 2))}`;
              const el = (
                <circle
                  key={s.key}
                  cx={C} cy={C} r={(R + r) / 2}
                  fill="none"
                  stroke={colorFor(i)}
                  strokeWidth={active === i ? width + 4 : width}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="round"
                  style={{
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    cursor: onSelect ? "pointer" : "default",
                    opacity: active === null || active === i ? 1 : 0.4,
                  }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => select(i, s.key)}
                />
              );
              offset += len;
              return el;
            })}
          </g>
          <text x={C} y={C - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)" fontWeight={750} style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {active != null ? segments[active].label : "Total"}
          </text>
          <text x={C} y={C + 16} textAnchor="middle" fontSize="22" fill="var(--ink)" className="hero-num">
            {active != null ? fmtMoney(segments[active].value) : fmtMoney(total)}
          </text>
          {active != null && (
            <text x={C} y={C + 36} textAnchor="middle" fontSize="13" fill="var(--ink-3)" fontWeight={600}>
              {pct(segments[active].value, total)}% of total
            </text>
          )}
        </svg>
      </div>

      <div style={{ flex: 1, minWidth: 280, display: "grid", gap: "0.4rem" }}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? `${s.label}, ${pct(s.value, total)}% — toggle holdings` : undefined}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => select(i, s.key)}
            onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(i, s.key); } } : undefined}
            style={{
              display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.5rem 0.75rem",
              borderRadius: 12, cursor: onSelect ? "pointer" : "default",
              background: active === i ? "var(--line-2)" : "transparent",
              transition: "all 0.2s ease",
              transform: active === i ? "translateX(4px)" : "none",
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 4, background: colorFor(i), flexShrink: 0, boxShadow: active === i ? `0 0 10px ${colorFor(i)}66` : "none" }} />
            <span style={{ fontSize: "0.9rem", color: "var(--ink)", flex: 1, fontWeight: 550 }}>{s.label}</span>
            <span className="hero-num" style={{ fontSize: "0.9rem", fontWeight: 650 }}>
              {fmtMoney(s.value)}
            </span>
            <span style={{ fontSize: "0.82rem", color: "var(--ink-3)", width: 48, textAlign: "right", fontWeight: 700 }}>
              {pct(s.value, total)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
