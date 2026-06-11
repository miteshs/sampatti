// Shared drag-to-zoom brush for the SVG charts: pointer-capture drag → live selection
// window in TIME units; the caller turns the committed range into a sliced view. Sub-day
// drags are clicks, not selections.

import { useState, type PointerEvent } from "react";

const MIN_BRUSH_MS = 86_400_000;

export function useBrush(
  timeAt: (clientX: number) => number,
  onBrush?: (from: number, to: number) => void,
) {
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (!onBrush) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const t = timeAt(e.clientX);
      setDrag({ a: t, b: t });
    },
    onPointerMove: (e: PointerEvent) => drag && setDrag({ a: drag.a, b: timeAt(e.clientX) }),
    onPointerUp: () => {
      if (!drag) return;
      const from = Math.min(drag.a, drag.b), to = Math.max(drag.a, drag.b);
      setDrag(null);
      if (onBrush && to - from >= MIN_BRUSH_MS) onBrush(from, to);
    },
    onPointerLeave: () => setDrag(null),
  };
  return { drag, handlers };
}
