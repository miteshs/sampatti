import { useEffect, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { demoPortfolio } from "../demo";
import { classifyFile, ingestFile, isImportable } from "../ingest";
import { inr } from "../domain/format";
import {
  ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL,
} from "../domain/classify";
import type {
  AccountType, AssetClass, ImportDraft, IncomeKind, Region, TaxTreatment,
} from "../domain/types";

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];
const ASSET_CLASSES = Object.keys(ASSET_CLASS_LABEL) as AssetClass[];
const TAX_TYPES = Object.keys(TAX_LABEL) as TaxTreatment[];
const REGIONS: Region[] = ["India", "US", "Other"];
const INCOME_KINDS: IncomeKind[] = ["salary", "rent", "business", "dividend", "interest", "other"];

const CSV_TEMPLATE =
  "account,institution,account_type,tax_treatment,region,currency,symbol,name,asset_class,units,market_value,cost_basis,buy_date,as_of\n" +
  "Zerodha Demat,Zerodha,demat,taxable,India,INR,RELIANCE,Reliance Industries,indian_equity,1180,3500000,2100000,2019-07-12,2026-05-31\n" +
  "Equity MF,CAMS,mutual_fund,taxable,India,INR,,Parag Parikh Flexi Cap,equity_mf,,5500000,3000000,2019-04-01,2026-05-31\n" +
  "PPF,SBI,epf_ppf,eee_exempt,India,INR,,PPF account,epf_ppf,,2800000,,,2026-03-31\n";

export function AddData() {
  const { replaceAll, addDraft, addAccount, addHolding, addIncome, portfolio } = useStore();
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<File[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // The folder picker is a plain file input with the (non-standard) webkitdirectory
  // attribute — supported by the desktop webview and browsers, no extra permissions.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const loadDemo = () => replaceAll(demoPortfolio());

  // Selection from either picker (one file, many files, or a whole folder tree).
  const onPick = (list: FileList | null) => {
    setErrors([]);
    setSkipped(0);
    const all = list ? Array.from(list) : [];
    if (all.length === 0) return;
    const importable = all.filter(isImportable);
    setSkipped(all.length - importable.length);
    if (importable.length === 0) {
      setErrors(["No importable files found — supported types are CSV, Excel, PDF, and images."]);
      return;
    }
    // If anything needs Claude, confirm the whole batch first; otherwise just parse.
    if (importable.some((f) => classifyFile(f) !== "local")) setPendingBatch(importable);
    else void runBatch(importable);
  };

  // Process a batch sequentially so progress is visible, cost is predictable, and one bad
  // file never aborts the rest — failures are collected and shown at the end.
  const runBatch = async (files: File[]) => {
    setPendingBatch(null);
    const errs: string[] = [];
    let done = 0;
    for (const f of files) {
      setBusy(`Processing ${++done} of ${files.length}: ${f.name}…`);
      try {
        const result = await ingestFile(f);
        setDrafts((d) => [...d, ...result]);
      } catch (e) {
        errs.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(null);
    setErrors(errs);
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sampatti-template.csv";
    a.click();
  };

  return (
    <div className="grid" style={{ gap: "1.25rem" }}>
      {/* Demo + import */}
      <div className="card">
        <div className="eyebrow">Get started</div>
        <h2 style={{ fontSize: "1.2rem", margin: "0.2rem 0 0.9rem" }}>Bring in your portfolio</h2>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={loadDemo}>▶ Load demo portfolio (₹12 Cr)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import files (CSV / Excel / PDF / image)</button>
          <button className="btn" onClick={() => folderRef.current?.click()}>📁 Import a whole folder</button>
          <button className="btn btn-ghost" onClick={downloadTemplate}>Download CSV template</button>
          <input
            ref={fileRef} type="file" hidden multiple
            accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp"
            onChange={(e) => { onPick(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={folderRef} type="file" hidden multiple
            onChange={(e) => { onPick(e.target.files); e.target.value = ""; }}
          />
        </div>
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.7rem" }}>
          Pick several files or a whole folder of statements at once. CSV and Excel are parsed
          entirely on this device; PDFs and screenshots are read with Claude (you'll confirm the
          batch first), because messy statements need AI to structure. Unsupported files are skipped.
        </p>
        {busy && <div style={{ marginTop: "0.7rem" }}><span className="spinner" /> <span className="muted">{busy}</span></div>}
        {!busy && skipped > 0 && !pendingBatch && (
          <div className="muted" style={{ marginTop: "0.7rem", fontSize: "0.78rem" }}>
            {skipped} unsupported file{skipped > 1 ? "s" : ""} skipped.
          </div>
        )}
        {errors.length > 0 && (
          <div className="badge badge-rose" style={{ marginTop: "0.7rem", padding: "0.4rem 0.7rem", display: "block" }}>
            {errors.map((er, i) => <div key={i} style={{ padding: "0.1rem 0" }}>{er}</div>)}
          </div>
        )}
      </div>

      {/* Confirm the batch before any document is sent to Claude */}
      {pendingBatch && (() => {
        const aiFiles = pendingBatch.filter((f) => classifyFile(f) !== "local");
        const localCount = pendingBatch.length - aiFiles.length;
        const n = pendingBatch.length;
        return (
          <div className="card" style={{ borderColor: "#e0e0ff", background: "linear-gradient(135deg,#f3f1ff,#fff)" }}>
            <h3 style={{ fontSize: "1rem" }}>Import {n} file{n > 1 ? "s" : ""}?</h3>
            <ul className="muted" style={{ fontSize: "0.84rem", margin: "0.4rem 0 0.8rem", paddingLeft: "1.1rem", lineHeight: 1.7 }}>
              {localCount > 0 && (
                <li><strong>{localCount}</strong> parsed on this device (CSV/Excel) — never sent anywhere.</li>
              )}
              {aiFiles.length > 0 && (
                <li>
                  <strong>{aiFiles.length}</strong> sent to Claude{" "}
                  {portfolio.settings.claudeMode === "byo" ? "with your own API key" : "via the relay"}{" "}
                  to extract holdings — not stored. You'll review each before saving.
                </li>
              )}
              {skipped > 0 && <li>{skipped} unsupported file{skipped > 1 ? "s" : ""} skipped.</li>}
            </ul>
            {aiFiles.length > 0 && (
              <details style={{ marginBottom: "0.7rem" }}>
                <summary className="muted" style={{ fontSize: "0.78rem", cursor: "pointer" }}>
                  Show the {aiFiles.length} file{aiFiles.length > 1 ? "s" : ""} going to Claude
                </summary>
                <div className="muted" style={{ fontSize: "0.76rem", marginTop: "0.3rem", maxHeight: 140, overflow: "auto" }}>
                  {aiFiles.map((f, i) => <div key={i}>• {f.name}</div>)}
                </div>
              </details>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary" onClick={() => void runBatch(pendingBatch)}>Import {n} file{n > 1 ? "s" : ""}</button>
              <button className="btn btn-ghost" onClick={() => { setPendingBatch(null); setSkipped(0); }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* Draft review */}
      {drafts.map((d, i) => (
        <DraftReview
          key={i} draft={d}
          onCommit={() => { addDraft(d); setDrafts((all) => all.filter((_, j) => j !== i)); }}
          onDiscard={() => setDrafts((all) => all.filter((_, j) => j !== i))}
        />
      ))}

      <ManualAccount onAdd={(acct, holdings) => {
        const id = addAccount(acct);
        for (const h of holdings) addHolding({ ...h, accountId: id });
      }} />

      <IncomeForm onAdd={addIncome} />
    </div>
  );
}

// ---- review an AI/file draft before saving ----
function DraftReview({ draft, onCommit, onDiscard }: {
  draft: ImportDraft; onCommit: () => void; onDiscard: () => void;
}) {
  const total = draft.holdings.reduce((s, h) => s + h.marketValue, 0);
  return (
    <div className="card" style={{ borderLeft: "3px solid var(--primary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <div className="eyebrow">Review draft · {draft.source}</div>
          <h3 style={{ fontSize: "1.05rem", marginTop: "0.15rem" }}>{draft.account.name}</h3>
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            {draft.account.institution} · {ACCOUNT_TYPE_LABEL[draft.account.accountType]} ·{" "}
            {TAX_LABEL[draft.account.taxTreatment]} · {draft.account.region} · {draft.account.currency}
            {draft.account.asOf ? ` · as of ${draft.account.asOf}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-primary" onClick={onCommit}>Add {draft.holdings.length} holdings · {inr(total)}</button>
          <button className="btn btn-ghost" onClick={onDiscard}>Discard</button>
        </div>
      </div>
      {draft.warnings.length > 0 && (
        <div className="badge badge-amber" style={{ marginTop: "0.6rem", padding: "0.4rem 0.7rem", display: "block" }}>
          {draft.warnings.join(" · ")}
        </div>
      )}
      <table style={{ marginTop: "0.7rem" }}>
        <thead><tr><th>Name</th><th>Class</th><th className="num">Value</th></tr></thead>
        <tbody>
          {draft.holdings.map((h, i) => (
            <tr key={i}>
              <td>{h.name}</td>
              <td><span className="badge badge-gray">{ASSET_CLASS_LABEL[h.assetClass]}</span></td>
              <td className="num" style={{ fontWeight: 600 }}>{inr(h.marketValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- manual account + holdings entry ----
function ManualAccount({ onAdd }: {
  onAdd: (a: ImportDraft["account"], h: ImportDraft["holdings"]) => void;
}) {
  const [a, setA] = useState<ImportDraft["account"]>({
    name: "", institution: "", accountType: "demat", taxTreatment: "taxable",
    region: "India", currency: "INR", asOf: new Date().toISOString().slice(0, 10),
  });
  const [hName, setHName] = useState("");
  const [hClass, setHClass] = useState<AssetClass>("indian_equity");
  const [hValue, setHValue] = useState("");
  const [holdings, setHoldings] = useState<ImportDraft["holdings"]>([]);

  const addH = () => {
    const v = Number(hValue.replace(/[₹,\s]/g, ""));
    if (!hName || !v) return;
    setHoldings((h) => [...h, { name: hName, assetClass: hClass, marketValue: v, currency: a.currency }]);
    setHName(""); setHValue("");
  };
  const save = () => {
    if (!a.name || holdings.length === 0) return;
    onAdd(a, holdings);
    setA({ ...a, name: "", institution: "" });
    setHoldings([]);
  };

  return (
    <div className="card">
      <div className="eyebrow">Manual entry</div>
      <h2 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0.9rem" }}>Add an account by hand</h2>
      <p className="muted" style={{ fontSize: "0.78rem", marginTop: "-0.6rem", marginBottom: "0.9rem" }}>
        Use this for real estate, cash, a PMS, an insurance policy, or anything without a clean export.
      </p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div><label>Account name</label><input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Mumbai flat" /></div>
        <div><label>Institution</label><input value={a.institution} onChange={(e) => setA({ ...a, institution: e.target.value })} /></div>
        <div><label>Type</label>
          <select value={a.accountType} onChange={(e) => setA({ ...a, accountType: e.target.value as AccountType })}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div><label>Tax</label>
          <select value={a.taxTreatment} onChange={(e) => setA({ ...a, taxTreatment: e.target.value as TaxTreatment })}>
            {TAX_TYPES.map((t) => <option key={t} value={t}>{TAX_LABEL[t]}</option>)}
          </select>
        </div>
        <div><label>Region</label>
          <select value={a.region} onChange={(e) => setA({ ...a, region: e.target.value as Region })}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div><label>Currency</label><input value={a.currency} onChange={(e) => setA({ ...a, currency: e.target.value.toUpperCase() })} /></div>
        <div><label>Statement date</label><input type="date" value={a.asOf} onChange={(e) => setA({ ...a, asOf: e.target.value })} /></div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 180px" }}><label>Holding / item name</label><input value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Flat market value" /></div>
        <div style={{ flex: "1 1 140px" }}><label>Class</label>
          <select value={hClass} onChange={(e) => setHClass(e.target.value as AssetClass)}>
            {ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 130px" }}><label>Value ({a.currency})</label><input value={hValue} onChange={(e) => setHValue(e.target.value)} placeholder="2500000" /></div>
        <button className="btn" onClick={addH}>+ Add item</button>
      </div>

      {holdings.length > 0 && (
        <table style={{ marginTop: "0.8rem" }}>
          <tbody>
            {holdings.map((h, i) => (
              <tr key={i}>
                <td>{h.name}</td>
                <td><span className="badge badge-gray">{ASSET_CLASS_LABEL[h.assetClass]}</span></td>
                <td className="num" style={{ fontWeight: 600 }}>{inr(h.marketValue)}</td>
                <td className="num"><button className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setHoldings((all) => all.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: "0.9rem" }}>
        <button className="btn btn-primary" onClick={save} disabled={!a.name || holdings.length === 0}>Save account</button>
      </div>
    </div>
  );
}

function IncomeForm({ onAdd }: { onAdd: (i: Omit<import("../domain/types").Income, "id">) => void }) {
  const [source, setSource] = useState("");
  const [kind, setKind] = useState<IncomeKind>("salary");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<"monthly" | "annual">("monthly");
  const save = () => {
    const v = Number(amount.replace(/[₹,\s]/g, ""));
    if (!source || !v) return;
    onAdd({ source, kind, amount: v, frequency, currency: "INR" });
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
        <div style={{ flex: "1 1 120px" }}><label>Amount (₹)</label><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="600000" /></div>
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
