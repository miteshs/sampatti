// Manual entry forms: an account-by-hand builder (real estate, cash, gold-by-weight, paired
// loans) and a simple income-source form. Both feed drafts up to AddData via onAdd callbacks.
import { useEffect, useState } from "react";
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL } from "../../domain/classify";
import type { AccountType, AssetClass, FlowKind, ImportDraft, Income, IncomeKind, Region, TaxTreatment } from "../../domain/types";
import { currentProfile, fmtMoney } from "../../regions/profile";
import { fetchGoldPerGramInr } from "../../domain/gold";
import { ACCOUNT_TYPES, ASSET_CLASSES, INCOME_KINDS, isGold, REGIONS, TAX_TYPES } from "./shared";

export function ManualAccount({ onAdd, usdInr }: {
  onAdd: (a: ImportDraft["account"], h: ImportDraft["holdings"], money: FlowKind, loanAmount?: number) => void;
  usdInr: number;
}) {
  const [a, setA] = useState<ImportDraft["account"]>({
    name: "", institution: "", accountType: "demat", taxTreatment: "taxable",
    region: currentProfile().region === "US" ? "US" : "India",
    currency: currentProfile().baseCurrency, asOf: new Date().toISOString().slice(0, 10),
  });
  const [money, setMoney] = useState<FlowKind>("tracking"); // pre-owned by default — see DraftReview
  const [hName, setHName] = useState("");
  const [hSym, setHSym] = useState(""); // optional ticker for equities/ETFs
  const [hClass, setHClass] = useState<AssetClass>(currentProfile().region === "US" ? "us_equity" : "indian_equity");
  const [hValue, setHValue] = useState("");
  const [hBasis, setHBasis] = useState(""); // optional purchase cost
  const [hGrams, setHGrams] = useState("");
  const [loan, setLoan] = useState(""); // optional remaining loan → paired liability account
  const [goldPrice, setGoldPrice] = useState<number | null>(null);
  const [goldBusy, setGoldBusy] = useState(false);
  const [holdings, setHoldings] = useState<ImportDraft["holdings"]>([]);

  // For gold, value comes from weight × the live ₹/gram rate, fetched when a gold class is
  // picked (and editable afterwards — e.g. for 22K or a dealer quote).
  useEffect(() => {
    if (!isGold(hClass) || !currentProfile().goldByWeight) return;
    setGoldBusy(true);
    void fetchGoldPerGramInr(usdInr).then((p) => { setGoldPrice((prev) => p ?? prev); setGoldBusy(false); });
  }, [hClass, usdInr]);

  const goldWeighed = isGold(hClass) && currentProfile().goldByWeight;
  const goldValue = goldWeighed && goldPrice ? Math.round((Number(hGrams.replace(/[,\s]/g, "")) || 0) * goldPrice) : 0;

  // A holding typed into the item fields but not yet added with "+ Add item".
  const pendingHolding = (): ImportDraft["holdings"][number] | null => {
    if (!hName.trim()) return null;
    const basis = Number(hBasis.replace(/[₹,\s]/g, "")) || undefined; // optional
    const symbol = hSym.trim() || undefined; // optional ticker
    if (goldWeighed) {
      const g = Number(hGrams.replace(/[,\s]/g, ""));
      if (!g || !goldPrice) return null;
      return { name: hName.trim(), symbol, assetClass: hClass, marketValue: Math.round(g * goldPrice), units: g, costBasis: basis, currency: a.currency };
    }
    const v = Number(hValue.replace(/[₹,\s]/g, ""));
    return v ? { name: hName.trim(), symbol, assetClass: hClass, marketValue: v, costBasis: basis, currency: a.currency } : null;
  };
  const addH = () => {
    const h = pendingHolding();
    if (!h) return;
    setHoldings((all) => [...all, h]);
    setHName(""); setHSym(""); setHValue(""); setHBasis(""); setHGrams("");
  };
  // Save folds in a typed-but-unadded holding so the form doesn't silently refuse to save.
  const canSave = !!a.name.trim() && (holdings.length > 0 || pendingHolding() != null);
  const save = () => {
    const extra = pendingHolding();
    const all = extra ? [...holdings, extra] : holdings;
    if (!a.name.trim() || all.length === 0) return;
    const loanAmt = Number(loan.replace(/[₹$,\s]/g, "")) || 0;
    onAdd(a, all, money, loanAmt > 0 ? loanAmt : undefined);
    setA({ ...a, name: "", institution: "" });
    setHoldings([]); setHName(""); setHSym(""); setHValue(""); setHBasis(""); setHGrams(""); setLoan("");
  };

  return (
    <div className="card">
      <div className="eyebrow">Manual entry</div>
      <h2 style={{ fontSize: "1.15rem", margin: "0.2rem 0 0.8rem", fontFamily: "var(--font-display)" }}>Add an account by hand</h2>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "-0.5rem", marginBottom: "1rem" }}>
        Real estate, cash, or anything without a clean export.
      </p>

      <div className="list-grouped" style={{ border: "1px solid var(--line-2)", marginBottom: "1rem" }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 0 }}>
          <div className="form-col" style={{ padding: "0.45rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><label style={{ marginBottom: "0.15rem" }}>Account name</label><input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Mumbai flat" style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
          <div className="form-col" style={{ padding: "0.45rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><label style={{ marginBottom: "0.15rem" }}>Institution</label><input value={a.institution} onChange={(e) => setA({ ...a, institution: e.target.value })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
          <div className="form-col" style={{ padding: "0.45rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><label style={{ marginBottom: "0.15rem" }}>Type</label>
            <select value={a.accountType} onChange={(e) => setA({ ...a, accountType: e.target.value as AccountType })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }}>
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="form-col" style={{ padding: "0.45rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><label style={{ marginBottom: "0.15rem" }}>Tax</label>
            <select value={a.taxTreatment} onChange={(e) => setA({ ...a, taxTreatment: e.target.value as TaxTreatment })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }}>
              {TAX_TYPES.filter((t) => currentProfile().taxTreatments.includes(t) || t === a.taxTreatment).map((t) => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="form-col" style={{ padding: "0.45rem 0.8rem", borderRight: "1px solid var(--line-2)" }}><label style={{ marginBottom: "0.15rem" }}>Region</label>
            <select value={a.region} onChange={(e) => setA({ ...a, region: e.target.value as Region })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-col" style={{ padding: "0.45rem 0.8rem", borderRight: "1px solid var(--line-2)" }}><label style={{ marginBottom: "0.15rem" }}>Currency</label><input value={a.currency} onChange={(e) => setA({ ...a, currency: e.target.value.toUpperCase() })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
          <div className="form-col" style={{ padding: "0.45rem 0.8rem" }}><label style={{ marginBottom: "0.15rem" }}>Date</label><input type="date" value={a.asOf} onChange={(e) => setA({ ...a, asOf: e.target.value })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} /></div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label>Remaining loan ({a.currency}) <span className="muted" style={{ fontWeight: 400 }}>— optional</span></label>
          <input value={loan} onChange={(e) => setLoan(e.target.value)} placeholder="e.g. home loan still owed" inputMode="decimal" />
        </div>
        <span className="muted" style={{ fontSize: "0.74rem", flex: "2 1 240px" }}>
          For a house, car, or anything with a loan against it — creates a matching <strong>liability</strong> so your net worth subtracts what you still owe.
        </span>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 180px" }}><label>Holding / item name</label><input value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Flat market value" /></div>
        <div style={{ flex: "1 1 100px" }}><label>Ticker <span className="muted" style={{ fontWeight: 400 }}>opt.</span></label><input value={hSym} onChange={(e) => setHSym(e.target.value)} placeholder="e.g. INFY" /></div>
        <div style={{ flex: "1 1 140px" }}><label>Class</label>
          <select value={hClass} onChange={(e) => setHClass(e.target.value as AssetClass)}>
            {ASSET_CLASSES.filter((c) => currentProfile().inManualEntry(c) || c === hClass).map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
          </select>
        </div>
        {goldWeighed ? (
          <>
            <div style={{ flex: "1 1 100px" }}><label>Weight (g)</label><input value={hGrams} onChange={(e) => setHGrams(e.target.value)} placeholder="50" inputMode="decimal" /></div>
            <div style={{ flex: "1 1 120px" }}><label>₹/gram</label>
              <input value={goldPrice ?? ""} onChange={(e) => setGoldPrice(Number(e.target.value) || null)} placeholder={goldBusy ? "..." : "price"} inputMode="decimal" />
            </div>
          </>
        ) : (
          <>
            <div style={{ flex: "1 1 120px" }}><label>Value ({a.currency})</label><input value={hValue} onChange={(e) => setHValue(e.target.value)} placeholder="2500000" /></div>
            <div style={{ flex: "1 1 120px" }}><label>Invested</label><input value={hBasis} onChange={(e) => setHBasis(e.target.value)} placeholder="optional" inputMode="decimal" /></div>
          </>
        )}
        <button className="btn" style={{ padding: "0.5rem 0.8rem" }} onClick={addH}>+ Add item</button>
      </div>
      {goldWeighed && (
        <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>
          {goldBusy && goldPrice == null ? "Fetching the live gold price…" : goldPrice ? (
            <>Live 24K gold ≈ <strong>₹{goldPrice.toLocaleString("en-IN")}/g</strong>
              {goldValue > 0 && <> · {hGrams}g = <strong>{fmtMoney(goldValue)}</strong></>}
              {" "}· editable (lower it ~8% for 22K, or use a dealer quote).</>
          ) : "Couldn't fetch the live gold price — enter ₹/gram manually."}
        </p>
      )}

      {holdings.length > 0 && (
        <table style={{ marginTop: "0.8rem" }}>
          <tbody>
            {holdings.map((h, i) => (
              <tr key={i}>
                <td>{h.name}</td>
                <td><span className="badge badge-gray">{ASSET_CLASS_LABEL[h.assetClass]}</span></td>
                <td className="num" style={{ fontWeight: 600 }}>{fmtMoney(h.marketValue)}</td>
                <td className="num"><button className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setHoldings((all) => all.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.7rem", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={save} disabled={!canSave}>Save account</button>
        <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: "0.74rem" }}>This money is:</span>
          <button className={`chip ${money === "tracking" ? "active" : ""}`} style={{ padding: "0.12rem 0.55rem", fontSize: "0.74rem" }}
            onClick={() => setMoney("tracking")}>already owned</button>
          <button className={`chip ${money === "flow" ? "active" : ""}`} style={{ padding: "0.12rem 0.55rem", fontSize: "0.74rem" }}
            onClick={() => setMoney("flow")}>new savings</button>
        </span>
        {!canSave && (
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {!a.name.trim() ? "Enter an account name" : "Add at least one holding (fill the name + value above)"} to save.
          </span>
        )}
      </div>
    </div>
  );
}

export function IncomeForm({ onAdd }: { onAdd: (i: Omit<Income, "id">) => void }) {
  const [source, setSource] = useState("");
  const [kind, setKind] = useState<IncomeKind>("salary");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "annual">("monthly");
  const save = () => {
    const v = Number(amount.replace(/[₹,\s]/g, ""));
    if (!source || !v) return;
    onAdd({ source, kind, amount: v, frequency, currency: currentProfile().baseCurrency });
    setSource(""); setAmount("");
  };
  return (
    <div className="card">
      <div className="eyebrow">Income</div>
      <h2 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0.9rem" }}>Add an income source</h2>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 180px" }}><label>Source</label><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Salary" /></div>
        <div style={{ flex: "1 1 120px" }}><label>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as IncomeKind)}>
            {INCOME_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 120px" }}><label>Amount ({currentProfile().symbol})</label><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={currentProfile().region === "US" ? "8000" : "600000"} /></div>
        <div style={{ flex: "1 1 110px" }}><label>Frequency</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as "monthly" | "annual")}>
            <option value="monthly">monthly</option><option value="annual">annual</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={save}>+ Add</button>
      </div>
    </div>
  );
}
