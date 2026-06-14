// Cmd/Ctrl-F search palette: find a holding by name, ticker, account, or asset class and jump
// to it. Read-only surfacing — click a result to open the Holdings tab (where you can edit it).
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio } from "../domain/types";
import { holdingBase } from "../domain/format";
import { fmtMoney } from "../regions/profile";
import { ASSET_CLASS_LABEL } from "../domain/classify";
import { tickerOf } from "../domain/aggregate";

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const portfolio = useStore((s) => s.portfolio);
  const focusHolding = useStore((s) => s.focusHolding);
  const usdInr = portfolio.settings.usdInr;
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(""); const t = setTimeout(() => inputRef.current?.focus(), 0); return () => clearTimeout(t); }
  }, [open]);

  const view = useMemo(() => visiblePortfolio(portfolio), [portfolio]);
  const acctById = useMemo(() => new Map(view.accounts.map((a) => [a.id, a])), [view.accounts]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return view.holdings
      .map((h) => {
        const a = acctById.get(h.accountId);
        return { h, a, value: holdingBase(h, usdInr), ticker: tickerOf(h.symbol, h.assetClass), cls: ASSET_CLASS_LABEL[h.assetClass] };
      })
      .filter(({ h, a, ticker, cls }) =>
        h.name.toLowerCase().includes(needle) ||
        !!ticker?.toLowerCase().includes(needle) ||
        !!a?.name.toLowerCase().includes(needle) ||
        cls.toLowerCase().includes(needle))
      .sort((x, y) => y.value - x.value)
      .slice(0, 50);
  }, [q, view.holdings, acctById, usdInr]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Find a holding" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <input
          ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search holdings, tickers, accounts…" aria-label="Search holdings"
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          style={{ width: "100%", fontSize: "1rem", padding: "0.6rem 0.7rem", boxSizing: "border-box" }}
        />
        <div style={{ marginTop: "0.6rem", maxHeight: 380, overflowY: "auto" }}>
          {q.trim() && results.length === 0 && <p className="muted" style={{ fontSize: "0.85rem", padding: "0.3rem" }}>No matches.</p>}
          {results.map(({ h, a, value, ticker, cls }) => (
            <button
              key={h.id} onClick={() => { focusHolding(h.id); onClose(); }}
              style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", width: "100%", textAlign: "left",
                padding: "0.45rem 0.5rem", border: "none", borderBottom: "1px solid var(--line-2)", background: "transparent", cursor: "pointer" }}
            >
              <span>
                <span style={{ fontWeight: 600 }}>{h.name}</span>
                {ticker && <span className="muted" style={{ fontSize: "0.8rem" }}> ({ticker})</span>}
                <span className="muted" style={{ fontSize: "0.78rem", display: "block" }}>{cls} · {a?.name ?? "—"}</span>
              </span>
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtMoney(value)}</span>
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.5rem" }}>Esc to close · click a result to jump to it</p>
      </div>
    </div>
  );
}
