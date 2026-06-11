// The x-axis under the trend/stack charts. Labels are plain HTML positioned under the SVG
// (not <text> inside it) so they never stretch with the chart and always render at the
// app's font size. Format adapts to the span: days → "9 Jun", months → "Jun ’26",
// multi-year → "2026".

const DAY = 86_400_000;

// Evenly spaced tick times across [minT, maxT], endpoints included.
export function tickTimes(minT: number, maxT: number, n = 4): number[] {
  if (!(maxT > minT)) return [minT];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(minT + ((maxT - minT) * i) / (n - 1));
  return out;
}

export function tickLabel(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs <= 120 * DAY) return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (spanMs <= 730 * DAY) return `${d.toLocaleDateString("en-IN", { month: "short" })} ’${String(d.getFullYear() % 100).padStart(2, "0")}`;
  return String(d.getFullYear());
}

// Dedupe consecutive identical labels (a 3-day chart would otherwise read "9 Jun" thrice).
export function tickRow(minT: number, maxT: number, n = 4): { t: number; label: string; frac: number }[] {
  const span = maxT - minT || 1;
  const ticks = tickTimes(minT, maxT, n).map((t) => ({ t, label: tickLabel(t, span), frac: (t - minT) / span }));
  return ticks.filter((tk, i) => i === 0 || tk.label !== ticks[i - 1].label);
}

// PAD/W mirror the chart SVGs so labels line up with the plotted x positions.
export function TimeAxis({ minT, maxT, pad = 6, width = 720 }: { minT: number; maxT: number; pad?: number; width?: number }) {
  const ticks = tickRow(minT, maxT);
  return (
    <div style={{ position: "relative", height: 16, marginTop: 2 }}>
      {ticks.map((tk, i) => {
        const left = ((pad + tk.frac * (width - 2 * pad)) / width) * 100;
        const edge = i === 0 ? "0%" : i === ticks.length - 1 ? "-100%" : "-50%";
        return (
          <span
            key={tk.t}
            className="muted"
            style={{
              position: "absolute", left: `${left}%`, transform: `translateX(${edge})`,
              fontSize: "0.7rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
            }}
          >
            {tk.label}
          </span>
        );
      })}
    </div>
  );
}
