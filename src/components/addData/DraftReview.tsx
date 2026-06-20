// Review an AI/file-parsed draft before saving. "Apply to" steers the re-import: auto-matched
// accounts (same institution+name) are preselected to Update; otherwise the user can pick any
// existing account to overwrite, or add a new one. Updating replaces that account's holdings
// wholesale (items sold since the last statement drop off; new items are added).
import { useEffect, useMemo, useState } from "react";
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL } from "../../domain/classify";
import { findMatchingAccount, isJoint } from "../../domain/types";
import type { Account, AssetClass, FlowKind, Holding, ImportDraft } from "../../domain/types";
import { currentProfile, fmtMoney } from "../../regions/profile";
import { findCrossAccountDuplicates } from "../../ingest/reconcile";
import { ASSET_CLASSES } from "./shared";

export function DraftReview({ draft, accounts, existingHoldings, onCurrency, onAccount, onHolding, onRemoveHolding, onApply, onDiscard }: {
  draft: ImportDraft; accounts: Account[]; existingHoldings: Holding[]; onCurrency: (currency: string) => void;
  onAccount: (patch: Partial<ImportDraft["account"]>) => void;
  onHolding: (hi: number, patch: Partial<ImportDraft["holdings"][number]>) => void;
  onRemoveHolding: (hi: number) => void;
  onApply: (target: "new" | string, money: FlowKind) => void; onDiscard: () => void;
}) {
  const total = draft.holdings.reduce((s, h) => s + h.marketValue, 0);
  const fmt = (v: number) => draft.account.currency === "INR" ? fmtMoney(v) : `${draft.account.currency} ${v.toLocaleString("en-US")}`;
  const matched = findMatchingAccount(accounts, draft.account);
  const [target, setTarget] = useState<"new" | string>(matched?.id ?? "new");
  // For a NEW account: is this money you already had (just starting to track it) or fresh
  // savings? Drives the growth-vs-added split on the trend card. "Already owned" is the safe
  // default — it never inflates your savings number.
  const [money, setMoney] = useState<FlowKind>("tracking");
  const targetAcct = target === "new" ? undefined : accounts.find((a) => a.id === target);
  // No exact (institution+name) match, but a same-name account exists (e.g. its institution was
  // edited) — surface it so the user can choose to overwrite instead of silently duplicating.
  const likely = matched ? undefined : accounts.find((a) => a.name.trim().toLowerCase() === draft.account.name.trim().toLowerCase());
  // Holdings that already exist in OTHER accounts (the CAS-overlap problem): a CAS lists
  // every fund, so funds tracked via a platform account would be double-counted. The
  // Apply-to target is excluded — replacing it is the point.
  const dupes = useMemo(
    () => findCrossAccountDuplicates(draft, existingHoldings, accounts, target === "new" ? undefined : target),
    [draft, existingHoldings, accounts, target],
  );
  const dupByIndex = useMemo(() => new Map(dupes.map((d) => [d.index, d])), [dupes]);
  const exactDupes = dupes.filter((d) => d.exact);
  const removeExactDupes = () => {
    // Remove highest index first so earlier indices stay valid.
    for (const d of [...exactDupes].sort((a, b) => b.index - a.index)) onRemoveHolding(d.index);
  };
  return (
    <div className="card" style={{ borderLeft: `3px solid ${matched ? "var(--amber, #d98324)" : "var(--primary)"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <div className="eyebrow">Review draft · {draft.source}</div>
          <input
            value={draft.account.name} onChange={(e) => onAccount({ name: e.target.value })}
            aria-label="Account name" placeholder="Account name"
            style={{ fontSize: "1.05rem", fontFamily: "var(--font-display)", fontWeight: 600,
              marginTop: "0.15rem", padding: "0.1rem 0.3rem", background: "transparent",
              border: "1px solid var(--line-2)", borderRadius: 6, width: "min(320px, 100%)" }}
          />
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
            <input
              value={draft.account.institution} onChange={(e) => onAccount({ institution: e.target.value })}
              aria-label="Institution" placeholder="institution"
              style={{ fontSize: "0.8rem", padding: "0.05rem 0.3rem", background: "transparent",
                border: "1px solid var(--line-2)", borderRadius: 6, width: "min(180px, 100%)" }}
            />
            <span>· {ACCOUNT_TYPE_LABEL[draft.account.accountType]} · {TAX_LABEL[draft.account.taxTreatment]} · {draft.account.region}
            {draft.account.asOf ? ` · as of ${draft.account.asOf}` : ""}</span>
          </div>
          {draft.account.holders && draft.account.holders.length > 0 && (
            <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.3rem", display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
              <span>{isJoint(draft.account.holders) ? "Holders" : "Holder"}: {draft.account.holders.join(", ")}</span>
              {isJoint(draft.account.holders) && <span className="badge-joint">Joint</span>}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginTop: "0.45rem" }}>
            <span className="muted" style={{ fontSize: "0.76rem" }}>Currency:</span>
            {["INR", "USD"].map((c) => (
              <button key={c} className={`chip ${draft.account.currency === c ? "active" : ""}`}
                style={{ padding: "0.12rem 0.55rem", fontSize: "0.76rem" }} onClick={() => onCurrency(c)}>{c}</button>
            ))}
            {!["INR", "USD"].includes(draft.account.currency) && (
              <button className="chip active" style={{ padding: "0.12rem 0.55rem", fontSize: "0.76rem" }} onClick={() => onCurrency(draft.account.currency)}>{draft.account.currency}</button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          {accounts.length > 0 && (
            <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
              <span className="muted" style={{ fontSize: "0.7rem", fontWeight: 600 }}>Apply to</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ maxWidth: 220 }}>
                <option value="new">➕ New account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>↻ Update: {a.name}{a.institution ? ` · ${a.institution}` : ""}</option>
                ))}
              </select>
            </label>
          )}
          <button className="btn btn-primary" onClick={() => onApply(target, money)} style={{ alignSelf: "flex-end" }}>
            {target === "new"
              ? `Add ${draft.holdings.length} holdings · ${fmt(total)}`
              : `↻ Replace with ${draft.holdings.length} · ${fmt(total)}`}
          </button>
          <button className="btn btn-ghost" onClick={onDiscard} style={{ alignSelf: "flex-end" }}>Discard</button>
        </div>
      </div>
      {target === "new" && (
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.6rem" }}>
          <span className="muted" style={{ fontSize: "0.76rem" }}>This money is:</span>
          <button className={`chip ${money === "tracking" ? "active" : ""}`} style={{ padding: "0.14rem 0.6rem", fontSize: "0.76rem" }}
            onClick={() => setMoney("tracking")}>I already owned it — just start tracking</button>
          <button className={`chip ${money === "flow" ? "active" : ""}`} style={{ padding: "0.14rem 0.6rem", fontSize: "0.76rem" }}
            onClick={() => setMoney("flow")}>It's new money (savings)</button>
          <span className="muted" style={{ fontSize: "0.72rem" }}>— keeps "your investments grew" separate from "you added money" on the trend.</span>
        </div>
      )}
      {matched && target === matched.id && (
        <div className="badge badge-amber" style={{ marginTop: "0.6rem", padding: "0.4rem 0.7rem", display: "block" }}>
          Matches an account you already have ({matched.institution} · {matched.name}) — preselected to <strong>Update</strong>.
          Updating replaces its current holdings with this statement (sold/removed items drop off). Switch “Apply to” to
          <strong> New account</strong> to keep both.
        </div>
      )}
      {targetAcct && !(matched && target === matched.id) && (
        <div className="badge badge-amber" style={{ marginTop: "0.6rem", padding: "0.4rem 0.7rem", display: "block" }}>
          This will <strong>replace</strong> the holdings of <strong>{targetAcct.name}</strong> ({targetAcct.institution || "—"}) with
          this statement, and update its details. Items not in this statement are removed.
        </div>
      )}
      {matched && target === "new" && (
        <div className="badge badge-rose" style={{ marginTop: "0.6rem", padding: "0.4rem 0.7rem", display: "block" }}>
          ⚠ An account named <strong>{matched.name}</strong> ({matched.institution}) already exists. Saving as
          <strong> New account</strong> will create a <strong>duplicate</strong> — switch “Apply to” to <strong>Update: {matched.name}</strong> above to overwrite it instead.
        </div>
      )}
      {likely && target === "new" && (
        <div className="badge badge-amber" style={{ marginTop: "0.6rem", padding: "0.4rem 0.7rem", display: "block" }}>
          A possibly-matching account already exists: <strong>{likely.name}</strong> ({likely.institution}). If this statement is for
          it, choose <strong>Update: {likely.name}</strong> under “Apply to” to overwrite rather than create a second copy.
        </div>
      )}
      {dupes.length > 0 && (
        <div className="badge badge-rose" style={{ marginTop: "0.6rem", padding: "0.45rem 0.7rem", display: "block" }}>
          ⚠ <strong>{dupes.length}</strong> of these holdings already exist in{" "}
          {[...new Set(dupes.map((d) => d.accountName))].join(", ")} — importing both would{" "}
          <strong>double-count</strong> your net worth (rows are marked below).
          {exactDupes.length > 0 && <> Same instrument <em>and</em> same size is almost certainly the
          same folio twice; different sizes may be a genuine second folio — keep those.</>}
          {exactDupes.length > 0 && (
            <button className="btn" style={{ marginLeft: "0.6rem", padding: "0.15rem 0.6rem", fontSize: "0.76rem" }} onClick={removeExactDupes}>
              Remove {exactDupes.length} exact duplicate{exactDupes.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
      {draft.warnings.length > 0 && (
        <div className="badge badge-amber" style={{ marginTop: "0.6rem", padding: "0.4rem 0.7rem", display: "block" }}>
          {draft.warnings.join(" · ")}
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.74rem", margin: "0.7rem 0 0.2rem" }}>
        Review &amp; fix anything the parser got wrong — edit a name, correct the asset class, adjust a value, or remove a row — before saving.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 160 }}>Name</th><th>Asset class</th>
            <th className="num">Value ({draft.account.currency})</th>
            <th className="num" title="Total purchase cost — optional; blank means gains will be measured from this import">Cost basis</th>
            <th>Buy date</th><th></th>
          </tr></thead>
          <tbody>
            {draft.holdings.map((h, i) => (
              <tr key={i} style={dupByIndex.has(i) ? { background: "var(--rose-soft)" } : undefined}>
                <td>
                  <input value={h.name} onChange={(e) => onHolding(i, { name: e.target.value })} style={{ width: "100%" }} />
                  {dupByIndex.has(i) && (
                    <span className={`badge ${dupByIndex.get(i)!.exact ? "badge-rose" : "badge-amber"}`} style={{ marginTop: "0.2rem", fontSize: "0.66rem" }}>
                      also in {dupByIndex.get(i)!.accountName}{dupByIndex.get(i)!.exact ? " · same size" : " · different size"}
                    </span>
                  )}
                </td>
                <td>
                  <select value={h.assetClass} onChange={(e) => onHolding(i, { assetClass: e.target.value as AssetClass })}>
                    {ASSET_CLASSES.filter((c) => currentProfile().inManualEntry(c) || c === h.assetClass).map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
                  </select>
                </td>
                <td className="num" style={{ maxWidth: 150 }}>
                  <DraftNum value={h.marketValue} onChange={(n) => onHolding(i, { marketValue: n })} />
                </td>
                <td className="num" style={{ maxWidth: 140 }}>
                  <DraftOptNum value={h.costBasis} placeholder="optional" onChange={(n) => onHolding(i, { costBasis: n })} />
                </td>
                <td style={{ maxWidth: 140 }}>
                  <input type="date" value={h.buyDate ?? ""} onChange={(e) => onHolding(i, { buyDate: e.target.value || undefined })} />
                </td>
                <td className="num">
                  <button className="btn btn-ghost" style={{ padding: "0.15rem 0.45rem" }} title="Remove holding" onClick={() => onRemoveHolding(i)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// DraftNum for an OPTIONAL number (cost basis): empty is a valid state and maps to undefined.
function DraftOptNum({ value, placeholder, onChange }: {
  value: number | undefined; placeholder?: string; onChange: (n: number | undefined) => void;
}) {
  const [s, setS] = useState(value == null ? "" : String(value));
  return (
    <input
      value={s} inputMode="decimal" placeholder={placeholder} style={{ width: 120, textAlign: "right" }}
      onChange={(e) => {
        const v = e.target.value;
        setS(v);
        const t = v.replace(/[,\s₹$]/g, "");
        if (t === "") { onChange(undefined); return; }
        const n = Number(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

// Buffered numeric input for a draft value — keeps a local string so partial/decimal edits
// don't fight the parsed number, and resyncs if the underlying value changes (e.g. row shift).
function DraftNum({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [s, setS] = useState(String(value));
  useEffect(() => {
    if (Number(s.replace(/[,\s₹$]/g, "")) !== value) setS(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      value={s} inputMode="decimal" style={{ width: 130, textAlign: "right" }}
      onChange={(e) => {
        const v = e.target.value;
        setS(v);
        const n = Number(v.replace(/[,\s₹$]/g, ""));
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
