// Inline editor that makes EVERY field of an imported (or manual) account editable after the
// fact — account name/institution/type/tax/region/currency/date, plus each holding's name,
// asset class, units, value and currency. Auto-saves to the store on change (the app persists
// on a debounce), so there's no separate "save" step; "Done" just collapses the editor.

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL } from "../domain/classify";
import { inr } from "../domain/format";
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
    <div className="card" style={{ background: "var(--surface-2, #fafafe)", borderLeft: "3px solid var(--primary)", marginTop: "0.4rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <div className="eyebrow">Edit account</div>
        <button className="btn btn-primary" style={{ padding: "0.25rem 0.8rem" }} onClick={onClose}>Done</button>
      </div>

      {/* Account-level fields */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div><label>Account name</label><input value={account.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div><label>Institution</label><input value={account.institution} onChange={(e) => set({ institution: e.target.value })} /></div>
        <div><label>Type</label>
          <select value={account.accountType} onChange={(e) => set({ accountType: e.target.value as AccountType })}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div><label>Tax treatment</label>
          <select value={account.taxTreatment} onChange={(e) => set({ taxTreatment: e.target.value as TaxTreatment })}>
            {TAX_TYPES.map((t) => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
          </select>
        </div>
        <div><label>Region / geo</label>
          <select value={account.region} onChange={(e) => set({ region: e.target.value as Region })}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div><label>Currency</label>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            <input value={account.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} style={{ minWidth: 0 }} />
            <button className="btn btn-ghost" title="Set every holding in this account to this currency"
              style={{ padding: "0.2rem 0.45rem", whiteSpace: "nowrap" }}
              onClick={setAllCurrency}>↧ all</button>
          </div>
        </div>
        <div><label>Statement date</label><input type="date" value={account.asOf ?? ""} onChange={(e) => set({ asOf: e.target.value || undefined })} /></div>
        <div><label>Note</label><input value={account.note ?? ""} onChange={(e) => set({ note: e.target.value || undefined })} placeholder="optional" /></div>
      </div>

      {/* Per-holding fields */}
      <div style={{ marginTop: "0.9rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: "0.92rem" }}>Holdings · {holdings.length}</h3>
        <button className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={addBlank}>+ Add holding</button>
      </div>
      {holdings.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>No holdings — add one, or this account contributes nothing to net worth.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "0.4rem" }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>Name</th>
                <th>Asset class</th>
                <th className="num">Units</th>
                <th className="num">Value</th>
                <th className="num" title="Total purchase cost (optional — left blank, gains are measured since first import)">Cost basis</th>
                <th>Buy date</th>
                <th>Ccy</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td><input value={h.name} onChange={(e) => editHolding(h.id, { name: e.target.value })} style={{ width: "100%" }} /></td>
                  <td>
                    <select value={h.assetClass} onChange={(e) => editHolding(h.id, { assetClass: e.target.value as AssetClass })}>
                      {ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
                    </select>
                  </td>
                  <td className="num" style={{ maxWidth: 90 }}>
                    <NumInput initial={h.units} allowEmpty placeholder="—" onCommit={(n) => editHolding(h.id, { units: n })} />
                  </td>
                  <td className="num" style={{ maxWidth: 130 }}>
                    <NumInput initial={h.marketValue} onCommit={(n) => { if (n !== undefined) editHolding(h.id, { marketValue: n }); }} />
                  </td>
                  <td className="num" style={{ maxWidth: 130 }}>
                    {/* An estimated (since-import) anchor renders as an empty field with a ≈ placeholder,
                        so the user can tell a real cost from the fallback at a glance. Typing a number
                        makes it real; clearing it reverts to the since-import anchor. */}
                    <NumInput
                      initial={h.costBasisEstimated ? undefined : h.costBasis}
                      allowEmpty placeholder={h.costBasisEstimated ? `≈ ${Math.round(h.costBasis ?? 0).toLocaleString("en-IN")}` : "—"}
                      onCommit={(n) => editHolding(h.id, n === undefined
                        ? { costBasis: undefined, costBasisEstimated: undefined } // store re-anchors to current value
                        : { costBasis: n, costBasisEstimated: undefined })}
                    />
                  </td>
                  <td style={{ maxWidth: 140 }}>
                    <input type="date" value={h.buyDate ?? ""} onChange={(e) => editHolding(h.id, { buyDate: e.target.value || undefined })} />
                  </td>
                  <td style={{ maxWidth: 70 }}>
                    <input value={h.currency} onChange={(e) => editHolding(h.id, { currency: e.target.value.toUpperCase() })} style={{ width: 56 }} />
                  </td>
                  <td className="num">
                    <button className="btn btn-ghost" title="Remove holding" style={{ padding: "0.15rem 0.45rem" }} onClick={() => removeWithLog(h.id, h.name)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.5rem" }}>
        Changes save automatically. Value is in each holding's currency; totals use ₹ at the app's USD→INR rate.
        Cost basis is optional — left blank (≈), gains on the Performance tab are measured since first import instead.
        Current account total ≈ {inr(holdings.reduce((s, h) => s + (h.currency === "INR" ? h.marketValue : h.marketValue * portfolio.settings.usdInr), 0))}.
      </p>
    </div>
  );
}
