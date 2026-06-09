// "Manage" tab — the data-mutation hub: include/exclude, edit, or remove accounts (with the
// inline per-account/holding editor), plus the manual-edit history log. Kept separate from
// Overview so the dashboard stays a clean read-only view.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { holdingBase, inr } from "../domain/format";
import { ACCOUNT_TYPE_LABEL } from "../domain/classify";
import { AccountEditor } from "./AccountEditor";
import { ManualEdits } from "./ManualEdits";

export function Manage() {
  const portfolio = useStore((s) => s.portfolio);
  const updateAccount = useStore((s) => s.updateAccount);
  const removeAccount = useStore((s) => s.removeAccount);
  const usdInr = portfolio.settings.usdInr;
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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
          Go to <strong>Add data</strong> to import a statement or enter accounts manually — then come back here to
          edit, include/exclude, or remove them.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: "1.25rem" }}>
      {/* Accounts — include/exclude from the view & analysis, edit, or remove entirely */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <div className="eyebrow">Accounts</div>
            <h2 style={{ fontSize: "1.05rem", marginTop: "0.15rem" }}>Edit, include &amp; remove accounts</h2>
          </div>
          <span className="muted" style={{ fontSize: "0.78rem", maxWidth: 300, textAlign: "right" }}>
            Unchecked accounts are left out of net worth, allocations &amp; AI analysis. Use ✎ to fix any field.
          </span>
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          {portfolio.accounts.map((a) => {
            const excluded = !!a.excluded;
            const editing = editingId === a.id;
            return (
              <div key={a.id}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0", borderTop: "1px solid var(--line-2)", opacity: excluded ? 0.55 : 1 }}>
                  <input type="checkbox" checked={!excluded} onChange={() => updateAccount(a.id, { excluded: !excluded })} style={{ flexShrink: 0, cursor: "pointer" }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => updateAccount(a.id, { excluded: !excluded })}>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                    {editedAccountIds.has(a.id) && <span className="badge badge-amber" style={{ marginLeft: "0.4rem", fontSize: "0.66rem" }} title="Has manual edits">✎ edited</span>}
                    <span className="muted" style={{ fontSize: "0.8rem" }}> · {a.institution || "—"} · {ACCOUNT_TYPE_LABEL[a.accountType]}</span>
                  </div>
                  <span className="num muted" style={{ fontSize: "0.84rem", flexShrink: 0 }}>{inr(acctTotals.get(a.id) ?? 0)}</span>
                  <button className={`btn btn-ghost ${editing ? "active" : ""}`} style={{ padding: "0.2rem 0.55rem", flexShrink: 0 }} title="Edit account & holdings"
                    onClick={() => setEditingId(editing ? null : a.id)}>✎</button>
                  {confirmRemove === a.id ? (
                    <span style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                      <button className="btn btn-danger" style={{ padding: "0.2rem 0.55rem" }} onClick={() => { removeAccount(a.id); setConfirmRemove(null); }}>Remove</button>
                      <button className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setConfirmRemove(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="btn btn-ghost" style={{ padding: "0.2rem 0.55rem", flexShrink: 0 }} title="Remove account" onClick={() => setConfirmRemove(a.id)}>✕</button>
                  )}
                </div>
                {editing && <AccountEditor accountId={a.id} onClose={() => setEditingId(null)} />}
              </div>
            );
          })}
        </div>
      </div>

      <ManualEdits />
    </div>
  );
}
