// "Refresh live prices" — revalue holdings from current market data so net worth tracks today
// without re-importing. Fetches units × latest price (equities/ETFs/MFs/gold), shows a preview
// of what would change and the net effect, then applies on confirm (updating each holding's
// value and stamping its account's as-of date to today). Untrackable holdings are left alone.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { liveRevalue, type Revaluation } from "../domain/market";
import { holdingBase } from "../domain/format";
import { currentProfile, fmtMoney } from "../regions/profile";

export function RefreshPrices() {
  const portfolio = useStore((s) => s.portfolio);
  const updateHolding = useStore((s) => s.updateHolding);
  const updateAccount = useStore((s) => s.updateAccount);
  const [status, setStatus] = useState<"idle" | "loading" | "preview" | "error">("idle");
  const [revals, setRevals] = useState<Revaluation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const usdInr = portfolio.settings.usdInr;
  const holdingById = useMemo(() => new Map(portfolio.holdings.map((h) => [h.id, h])), [portfolio.holdings]);

  const load = async () => {
    setStatus("loading");
    setError(null);
    try {
      const r = await liveRevalue(portfolio.holdings, usdInr);
      // Keep only material changes (ignore sub-0.1% / sub-rupee noise).
      const changed = r.filter((x) => Math.abs(x.newValue - x.oldValue) > Math.max(1, x.oldValue * 0.001));
      setRevals(changed);
      setStatus("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  };

  const apply = () => {
    const today = new Date().toISOString().slice(0, 10);
    const accounts = new Set<string>();
    for (const r of revals) {
      updateHolding(r.holdingId, { marketValue: r.newValue });
      const h = holdingById.get(r.holdingId);
      if (h) accounts.add(h.accountId);
    }
    for (const id of accounts) updateAccount(id, { asOf: today });
    setRevals([]);
    setStatus("idle");
  };

  const deltaBase = useMemo(() => revals.reduce((s, r) => {
    const h = holdingById.get(r.holdingId);
    return h ? s + holdingBase({ ...h, marketValue: r.newValue }, usdInr) - holdingBase(h, usdInr) : s;
  }, 0), [revals, holdingById, usdInr]);

  if (portfolio.holdings.length === 0) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <div className="eyebrow">Live prices</div>
          <h2 style={{ fontSize: "1.05rem", marginTop: "0.15rem" }}>Refresh from the market</h2>
        </div>
        {status === "idle" && <button className="btn" onClick={load}>↻ Refresh live prices</button>}
        {status === "loading" && <span className="muted"><span className="spinner" /> fetching prices…</span>}
      </div>

      {status === "idle" && (
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.5rem", maxWidth: 560 }}>
          Revalues holdings that have a quantity and a recognizable symbol — {currentProfile().region === "US"
            ? "US-listed stocks & ETFs (by ticker) and crypto"
            : "listed equities/ETFs (NSE & US), Indian mutual funds (by ISIN), and gold by weight"} — using
          today's price. You'll preview the changes before anything is saved. Only tickers/ISINs are
          sent; never your holdings.
        </p>
      )}

      {status === "error" && (
        <div style={{ marginTop: "0.7rem" }}>
          <div className="badge badge-rose" style={{ padding: "0.4rem 0.7rem", display: "block" }}>
            Couldn't fetch prices{error ? `: ${error}` : ""}.
          </div>
          <button className="btn" style={{ marginTop: "0.5rem" }} onClick={load}>Retry</button>
        </div>
      )}

      {status === "preview" && (
        <div style={{ marginTop: "0.7rem" }}>
          {revals.length === 0 ? (
            <div>
              <p className="muted" style={{ fontSize: "0.84rem" }}>Everything is already current — no material price changes found.</p>
              <button className="btn btn-ghost" style={{ marginTop: "0.4rem" }} onClick={() => setStatus("idle")}>Close</button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 700 }}>{revals.length} holding{revals.length === 1 ? "" : "s"} will update</span>
                <span style={{ fontWeight: 700, color: deltaBase >= 0 ? "var(--up-ink)" : "var(--down-ink)" }}>
                  net {deltaBase >= 0 ? "+" : "−"}{fmtMoney(Math.abs(deltaBase))}
                </span>
              </div>
              <div style={{ maxHeight: 260, overflow: "auto" }}>
                <table>
                  <thead><tr><th>Holding</th><th className="num">Now</th><th className="num">New</th></tr></thead>
                  <tbody>
                    {revals.map((r) => {
                      const h = holdingById.get(r.holdingId);
                      const ccy = h?.currency ?? "INR";
                      const f = (v: number) => ccy === "INR" ? fmtMoney(v) : `${ccy} ${Math.round(v).toLocaleString("en-US")}`;
                      const upd = r.newValue >= r.oldValue;
                      return (
                        <tr key={r.holdingId}>
                          <td>{h?.name ?? "—"}</td>
                          <td className="num muted">{f(r.oldValue)}</td>
                          <td className="num" style={{ fontWeight: 600, color: upd ? "var(--up-ink)" : "var(--down-ink)" }}>{f(r.newValue)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.7rem" }}>
                <button className="btn btn-primary" onClick={apply}>Apply {revals.length} update{revals.length === 1 ? "" : "s"}</button>
                <button className="btn btn-ghost" onClick={() => setStatus("idle")}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
