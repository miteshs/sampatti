// "Manage" tab — the data-mutation hub: include/exclude, edit, or remove accounts (with the
// inline per-account/holding editor), plus the manual-edit history log. Kept separate from
// Overview so the dashboard stays a clean read-only view.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { holdingBase } from "../domain/format";
import { fmtMoney } from "../regions/profile";
import { ACCOUNT_TYPE_LABEL } from "../domain/classify";
import { holderSummary, isJoint, visiblePortfolio } from "../domain/types";
import { AccountEditor } from "./AccountEditor";
import { ManualEdits } from "./ManualEdits";
import { RefreshPrices } from "./RefreshPrices";
import { freshness, FRESH_BADGE } from "./ui";

export function Manage() {
  const portfolio = useStore((s) => s.portfolio);
  const updateAccount = useStore((s) => s.updateAccount);
  const removeAccount = useStore((s) => s.removeAccount);
  const usdInr = portfolio.settings.usdInr;
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // When search surfaces a holding, expand the account that holds it so its row is on screen
  // (App then scrolls + flashes the row).
  const focusHoldingId = useStore((s) => s.focusHoldingId);
  useEffect(() => {
    if (!focusHoldingId) return;
    const acctId = portfolio.holdings.find((h) => h.id === focusHoldingId)?.accountId;
    if (acctId) setEditingId(acctId);
  }, [focusHoldingId, portfolio.holdings]);

  // Freshness over the *visible* accounts (matches the dashboard's net-worth scope).
  const staleAccounts = useMemo(() => visiblePortfolio(portfolio).accounts
    .filter((a) => a.accountType !== "liability" && a.accountType !== "income")
    .map((a) => ({ a, f: freshness(a.asOf) }))
    .filter((x) => x.f.status !== "fresh")
    .sort((x, y) => (y.f.days ?? 1e9) - (x.f.days ?? 1e9)), [portfolio]);

  // Per-account totals from the raw portfolio (so excluded accounts still show a value).
  const acctTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of portfolio.holdings) m.set(h.accountId, (m.get(h.accountId) ?? 0) + holdingBase(h, usdInr));
    return m;
  }, [portfolio.holdings, usdInr]);

  // Accounts that carry any manual edit (account-level, or a still-present holding's edit).
  const editedAccountIds = useMemo(() => {
    const ids = new Set<string>();
    const holdAcct = new Map(portfolio.holdings.map((h) => [h.id, h.accountId]));
    for (const e of portfolio.edits) {
      if (e.entity === "account") ids.add(e.entityId);
      else { const aid = holdAcct.get(e.entityId); if (aid) ids.add(aid); }
    }
    return ids;
  }, [portfolio.edits, portfolio.holdings]);

  if (portfolio.accounts.length === 0) {
    return (
      <div className="card card-pad-lg" style={{ textAlign: "center", padding: "3rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>No accounts yet</div>
        <p className="muted" style={{ maxWidth: 440, margin: "0.5rem auto 0" }}>
          Go to <strong>Holdings</strong> to import a statement or enter accounts manually — then come back here to
          edit, include/exclude, or remove them.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: "1rem" }}>
      {/* Accounts — include/exclude from the view & analysis, edit, or remove entirely */}
      <div className="card" style={{ paddingBottom: "0.2rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
          <div>
            <div className="eyebrow">Accounts</div>
            <h2 style={{ fontSize: "1.2rem", marginTop: "0.15rem", fontFamily: "var(--font-display)" }}>Manage your ledger</h2>
          </div>
          <span className="muted" style={{ fontSize: "0.78rem", maxWidth: 300, textAlign: "right" }}>
            Untick to exclude from analysis. Actions appear when needed.
          </span>
        </div>
        
        <div className="list-grouped" style={{ marginTop: "0.5rem", border: "none", boxShadow: "none" }}>
          {portfolio.accounts.map((a, i) => {
            const excluded = !!a.excluded;
            const editing = editingId === a.id;
            return (
              <div key={a.id}>
                <div className="list-row" style={{ padding: "0.55rem 0", borderTop: i === 0 ? "none" : "1px solid var(--line-2)", opacity: excluded ? 0.5 : 1 }}>
                  <input type="checkbox" checked={!excluded} onChange={() => updateAccount(a.id, { excluded: !excluded })}
                    aria-label={`Include ${a.name} in totals and analysis`} title="Include in totals & analysis"
                    style={{ flexShrink: 0, width: "16px", height: "16px" }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => updateAccount(a.id, { excluded: !excluded })}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 650, fontSize: "0.9rem", color: "var(--ink)" }}>{a.name}</span>
                      {isJoint(a.holders) && <span className="badge-joint">Joint</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.05rem" }}>
                      {editedAccountIds.has(a.id) && <span className="badge badge-amber" style={{ fontSize: "0.6rem", padding: "0.05rem 0.35rem" }}>edited</span>}
                      <span className="muted eyebrow" style={{ fontSize: "0.62rem" }}>{a.institution || "—"} · {ACCOUNT_TYPE_LABEL[a.accountType]}{holderSummary(a.holders) ? ` · ${holderSummary(a.holders)}` : ""}</span>
                    </div>
                  </div>
                  <span className="hero-num" style={{ fontSize: "0.95rem", flexShrink: 0, color: "var(--ink)" }}>{fmtMoney(acctTotals.get(a.id) ?? 0)}</span>
                  <button className={`btn btn-ghost ${editing ? "active" : ""}`} style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                    onClick={() => setEditingId(editing ? null : a.id)}>Edit</button>
                  {confirmRemove === a.id ? (
                    <span style={{ display: "flex", gap: "0.2rem" }}>
                      <button className="btn btn-danger" style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }} onClick={() => { removeAccount(a.id); setConfirmRemove(null); }}>Remove</button>
                      <button className="btn btn-ghost" style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }} onClick={() => setConfirmRemove(null)}>✕</button>
                    </span>
                  ) : (
                    <button className="btn btn-ghost" style={{ padding: "0.2rem 0.4rem" }} onClick={() => setConfirmRemove(a.id)}>✕</button>
                  )}
                </div>
                {editing && <div style={{ padding: "0 0 1rem" }}><AccountEditor accountId={a.id} onClose={() => setEditingId(null)} /></div>}
              </div>
            );
          })}
        </div>
      </div>

      <RefreshPrices />

      <div className="card">
        <h2 style={{ fontSize: "1rem", fontFamily: "var(--font-display)", marginBottom: "0.75rem" }}>Data freshness</h2>
        {staleAccounts.length > 0 ? (
          <div className="list-grouped">
            {staleAccounts.map(({ a, f }) => (
              <div key={a.id} className="list-row" style={{ justifyContent: "space-between", padding: "0.5rem 0.8rem" }}>
                <span style={{ fontWeight: 550, fontSize: "0.85rem" }}>{a.name}</span>
                <span style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: "0.78rem" }}>
                    {a.asOf ? f.days != null ? `${f.days}d ago` : a.asOf : "no date"}
                  </span>
                  <span className={`badge ${FRESH_BADGE[f.status]}`} style={{ fontSize: "0.65rem" }}>{f.status}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: "0.8rem" }}>Everything is current.</p>
        )}
      </div>

      <ManualEdits />
    </div>
  );
}
