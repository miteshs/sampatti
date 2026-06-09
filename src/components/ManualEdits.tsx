// Provenance trail: a collapsible log of the values the user changed by hand (in the account
// editor). Lets them see exactly which numbers are manual overrides — these stay put on a
// live-price refresh, but a re-imported statement will replace them.

import { useState } from "react";
import { useStore } from "../storage/store";

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ManualEdits() {
  const edits = useStore((s) => s.portfolio.edits);
  const clearEdits = useStore((s) => s.clearEdits);
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!edits || edits.length === 0) return null;
  const recent = [...edits].reverse(); // most recent first

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="eyebrow">Provenance</div>
          <h2 style={{ fontSize: "1.05rem", marginTop: "0.15rem" }}>Manual edits · {edits.length}</h2>
        </div>
        <span className="muted" style={{ fontSize: "0.9rem" }}>{open ? "▾ hide" : "▸ show"}</span>
      </div>
      <p className="muted" style={{ fontSize: "0.76rem", margin: "0.35rem 0 0" }}>
        Values you changed by hand. They override imported data and stay put on a live-price refresh —
        a re-imported statement will replace them.
      </p>
      {open && (
        <>
          <div style={{ marginTop: "0.6rem", maxHeight: 300, overflow: "auto" }}>
            {recent.map((e) => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", padding: "0.35rem 0", borderTop: "1px solid var(--line-2)", fontSize: "0.82rem" }}>
                <span>
                  <span className="badge badge-gray" style={{ fontSize: "0.66rem", marginRight: "0.35rem" }}>{e.entity}</span>
                  <strong>{e.label}</strong> <span className="muted">· {e.field}</span>
                  {(e.from != null || e.to != null) && <> : <span className="muted">{e.from ?? "—"}</span> → <strong>{e.to ?? "—"}</strong></>}
                </span>
                <span className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.72rem" }}>{fmtWhen(e.at)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            {confirmClear ? (
              <span style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: "0.78rem" }}>Clear this history? Your data stays — only the edit log is removed.</span>
                <button className="btn btn-danger" style={{ padding: "0.2rem 0.55rem" }} onClick={() => { clearEdits(); setConfirmClear(false); }}>Clear</button>
                <button className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setConfirmClear(false)}>Cancel</button>
              </span>
            ) : (
              <button className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={() => setConfirmClear(true)}>Clear edit log</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
