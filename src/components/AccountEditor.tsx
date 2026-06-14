// Inline editor that makes EVERY field of an imported (or manual) account editable after the
// fact — account name/institution/type/tax/region/currency/date, plus each holding's name,
// asset class, units, value and currency. Auto-saves to the store on change (the app persists
// on a debounce), so there's no separate "save" step; "Done" just collapses the editor.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL } from "../domain/classify";
import { currentProfile, fmtMoney } from "../regions/profile";
import type { AccountType, AssetClass, Region, TaxTreatment } from "../domain/types";

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];
const ASSET_CLASSES = Object.keys(ASSET_CLASS_LABEL) as AssetClass[];
const TAX_TYPES = Object.keys(TAX_LABEL) as TaxTreatment[];
const REGIONS: Region[] = ["India", "US", "Other"];

// A number input that keeps its own text buffer so decimals/partial edits don't fight the
// store (which holds a parsed number). Commits the parsed value on every valid change.
function NumInput({ initial, onCommit, placeholder, allowEmpty }: {
  initial: number | undefined; onCommit: (n: number | undefined) => void;
  placeholder?: string; allowEmpty?: boolean;
}) {
  const [str, setStr] = useState(initial == null ? "" : String(initial));
  return (
    <input
      value={str} inputMode="decimal" placeholder={placeholder}
      style={{ textAlign: "right" }}
      onChange={(e) => {
        const v = e.target.value;
        setStr(v);
        const t = v.replace(/[,\s₹$]/g, "");
        if (t === "") { if (allowEmpty) onCommit(undefined); return; }
        const n = Number(t);
        if (Number.isFinite(n)) onCommit(n);
      }}
    />
  );
}

export function AccountEditor({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  // Select the stable `portfolio` reference and derive with useMemo. Returning a fresh
  // array/object straight from a zustand selector (e.g. `.filter(...)`) makes every render
  // look like a new snapshot to useSyncExternalStore → infinite re-render loop → blank screen.
  const portfolio = useStore((s) => s.portfolio);
  const editAccount = useStore((s) => s.editAccount);
  const editHolding = useStore((s) => s.editHolding);
  const updateHolding = useStore((s) => s.updateHolding);
  const removeHolding = useStore((s) => s.removeHolding);
  const addHolding = useStore((s) => s.addHolding);
  const logEdit = useStore((s) => s.logEdit);

  const account = useMemo(() => portfolio.accounts.find((a) => a.id === accountId), [portfolio.accounts, accountId]);
  const holdings = useMemo(() => portfolio.holdings.filter((h) => h.accountId === accountId), [portfolio.holdings, accountId]);

  if (!account) return null;
  const set = (patch: Parameters<typeof editAccount>[1]) => editAccount(accountId, patch);

  const addBlank = () => {
    const id = addHolding({
      accountId,
      name: "New holding",
      assetClass: account.defaultAssetClass ?? (account.region === "US" ? "us_equity" : "indian_equity"),
      marketValue: 0,
      currency: account.currency,
    });
    logEdit({ entity: "holding", entityId: id, label: "New holding", field: "added" });
  };

  // Cascade currency to every holding — recorded as one summary edit (not 50 line edits).
  const setAllCurrency = () => {
    holdings.forEach((h) => updateHolding(h.id, { currency: account.currency }));
    logEdit({ entity: "account", entityId: accountId, label: account.name, field: "all holdings currency", to: account.currency });
  };

  const removeWithLog = (id: string, name: string) => {
    logEdit({ entity: "holding", entityId: id, label: name, field: "removed" });
    removeHolding(id);
  };

  return (
    <div className="card" style={{ background: "var(--surface-2)", border: "1px solid var(--line)", marginTop: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.8rem" }}>
        <h3 style={{ fontSize: "1rem", fontFamily: "var(--font-display)" }}>Account Details</h3>
        <button className="btn btn-primary" style={{ padding: "0.2rem 0.7rem", fontSize: "0.75rem" }} onClick={onClose}>Done</button>
      </div>

      {/* Account-level fields in a grouped list style */}
      <div className="list-grouped" style={{ border: "1px solid var(--line-2)" }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 0 }}>
          <div className="form-col" style={{ borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)", padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Account name</label><input value={account.name} onChange={(e) => set({ name: e.target.value })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
          <div className="form-col" style={{ borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)", padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Institution</label><input value={account.institution} onChange={(e) => set({ institution: e.target.value })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
          <div className="form-col" style={{ borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)", padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Type</label>
            <select value={account.accountType} onChange={(e) => set({ accountType: e.target.value as AccountType })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }}>
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="form-col" style={{ borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)", padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Tax treatment</label>
            <select value={account.taxTreatment} onChange={(e) => set({ taxTreatment: e.target.value as TaxTreatment })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }}>
              {TAX_TYPES.filter((t) => currentProfile().taxTreatments.includes(t) || t === account.taxTreatment).map((t) => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="form-col" style={{ borderRight: "1px solid var(--line-2)", padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Region / geo</label>
            <select value={account.region} onChange={(e) => set({ region: e.target.value as Region })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-col" style={{ borderRight: "1px solid var(--line-2)", padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Currency</label>
            <div style={{ display: "flex", gap: "0.3rem" }}>
              <input value={account.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none", minWidth: 0 }} />
              <button className="btn btn-ghost" title="Set every holding to this currency" style={{ padding: "0", fontSize: "0.7rem" }} onClick={setAllCurrency}>↧ all</button>
            </div>
          </div>
          <div className="form-col" style={{ borderRight: "1px solid var(--line-2)", padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Statement date</label><input type="date" value={account.asOf ?? ""} onChange={(e) => set({ asOf: e.target.value || undefined })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
          <div className="form-col" style={{ padding: "0.5rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Note</label><input value={account.note ?? ""} onChange={(e) => set({ note: e.target.value || undefined })} placeholder="optional" style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
        </div>
      </div>

      {/* Per-holding fields */}
      <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ fontSize: "0.95rem", fontFamily: "var(--font-display)" }}>Holdings · {holdings.length}</h3>
        <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem" }} onClick={addBlank}>+ Add holding</button>
      </div>
      {holdings.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.3rem" }}>No holdings in this account.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "0.4rem" }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Name</th>
                <th>Class</th>
                <th className="num">Units</th>
                <th className="num">Value</th>
                <th className="num">Basis</th>
                <th>Date</th>
                <th>Ccy</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td><input value={h.name} onChange={(e) => editHolding(h.id, { name: e.target.value })} style={{ width: "100%", border: "none", padding: "0.1rem 0", background: "transparent", boxShadow: "none", fontSize: "0.88rem", fontWeight: 550 }} /></td>
                  <td>
                    <select value={h.assetClass} onChange={(e) => editHolding(h.id, { assetClass: e.target.value as AssetClass })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none", fontSize: "0.82rem" }}>
                      {ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
                    </select>
                  </td>
                  <td className="num" style={{ maxWidth: 80 }}>
                    <NumInput initial={h.units} allowEmpty placeholder="—" onCommit={(n) => editHolding(h.id, { units: n })} />
                  </td>
                  <td className="num" style={{ maxWidth: 110 }}>
                    <NumInput initial={h.marketValue} onCommit={(n) => { if (n !== undefined) editHolding(h.id, { marketValue: n }); }} />
                  </td>
                  <td className="num" style={{ maxWidth: 110 }}>
                    <NumInput
                      initial={h.costBasisEstimated ? undefined : h.costBasis}
                      allowEmpty placeholder={h.costBasisEstimated ? `≈ ${Math.round(h.costBasis ?? 0).toLocaleString("en-IN")}` : "—"}
                      onCommit={(n) => editHolding(h.id, n === undefined
                        ? { costBasis: undefined, costBasisEstimated: undefined }
                        : { costBasis: n, costBasisEstimated: undefined })}
                    />
                  </td>
                  <td style={{ maxWidth: 120 }}>
                    <input type="date" value={h.buyDate ?? ""} onChange={(e) => editHolding(h.id, { buyDate: e.target.value || undefined })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none", fontSize: "0.82rem" }} />
                  </td>
                  <td style={{ maxWidth: 50 }}>
                    <input value={h.currency} onChange={(e) => editHolding(h.id, { currency: e.target.value.toUpperCase() })} style={{ width: 44, border: "none", padding: 0, background: "transparent", boxShadow: "none", fontSize: "0.82rem" }} />
                  </td>
                  <td className="num">
                    <button className="btn btn-ghost" title="Remove holding" style={{ padding: "0.15rem 0.4rem" }} onClick={() => removeWithLog(h.id, h.name)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.6rem", borderTop: "1px solid var(--line-2)", paddingTop: "0.5rem" }}>
        Changes save automatically. Total ≈ <strong>{fmtMoney(holdings.reduce((s, h) => s + (h.currency === "INR" ? h.marketValue : h.marketValue * portfolio.settings.usdInr), 0))}</strong>.
      </p>
    </div>
  );
}
