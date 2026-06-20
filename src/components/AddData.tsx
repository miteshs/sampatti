import { useEffect, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { demoPortfolio } from "../demo";
import { classifyFile, ingestFile, ingestPdf, ingestWithClaude, isImportable, NeedsClaudeError, PdfPasswordError } from "../ingest";
import { filesForClaude, planBatch } from "../ingest/consent";
import { engineFor, localModelReady, withExtractionEngine } from "../ai/engine";
import { currentProfile } from "../regions/profile";
import type { AiEngine, ImportDraft } from "../domain/types";
import { AuthErrorModal } from "./addData/AuthErrorModal";
import { Welcome, GettingStarted } from "./addData/Onboarding";
import { DraftReview } from "./addData/DraftReview";
import { ManualAccount, IncomeForm } from "./addData/ManualEntry";

// AuthErrorModal lives in its own module now; re-export so existing importers (AnalysisChat)
// keep importing it from "./AddData".
export { AuthErrorModal };

const CSV_HEADER =
  "account,institution,account_type,tax_treatment,region,currency,symbol,name,asset_class,units,market_value,cost_basis,buy_date,as_of\n";
const CSV_TEMPLATE_IN = CSV_HEADER +
  "Zerodha Demat,Zerodha,demat,taxable,India,INR,RELIANCE,Reliance Industries,indian_equity,1180,3500000,2100000,2019-07-12,2026-05-31\n" +
  "Equity MF,CAMS,mutual_fund,taxable,India,INR,,Parag Parikh Flexi Cap,equity_mf,,5500000,3000000,2019-04-01,2026-05-31\n" +
  "PPF,SBI,epf_ppf,eee_exempt,India,INR,,PPF account,epf_ppf,,2800000,,,2026-03-31\n";
const CSV_TEMPLATE_US = CSV_HEADER +
  "Schwab Brokerage,Charles Schwab,demat,taxable,US,USD,AAPL,Apple Inc,us_equity,120,30000,16000,2020-03-20,2026-05-31\n" +
  "Fidelity 401(k),Fidelity,mutual_fund,us_pretax,US,USD,FXAIX,Fidelity 500 Index Fund,equity_mf,,185000,120000,2018-06-01,2026-05-31\n" +
  "Roth IRA,Vanguard,mutual_fund,us_roth,US,USD,VTI,Vanguard Total Stock Market ETF,index_etf,150,46000,29000,2019-04-01,2026-05-31\n";

// A pending draft carries a STABLE key so React preserves each review card's own state
// (its "Apply to" target, edited fields) when other drafts are committed/removed. Keying by
// array index instead silently reassigns one card's target to a different draft → wrong
// merges and duplicate accounts.
type Pending = { key: string; draft: ImportDraft };
let draftSeq = 0;
const wrapDrafts = (ds: ImportDraft[]): Pending[] => ds.map((draft) => ({ key: `d${draftSeq++}`, draft }));

export function AddData({ onConfigure }: { onConfigure?: () => void }) {
  const { replaceAll, addDraft, mergeDraftInto, addAccount, addHolding, addIncome, wipe, portfolio } = useStore();
  const [drafts, setDrafts] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // A gated batch remembers which engine the user consented to — "use Claude this time"
  // must not silently route to the (absent) local model, and vice versa.
  const [pendingBatch, setPendingBatch] = useState<{ files: File[]; engine: AiEngine } | null>(null);
  // Local engine chosen but the model isn't on disk: these files wait for download-or-Claude.
  const [modelGate, setModelGate] = useState<File[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [needsClaude, setNeedsClaude] = useState<{ file: File; reason: string }[]>([]);
  // Password-protected PDFs (a CAS, usually) waiting for their password — decrypted and
  // parsed on this device when provided. Each carries its batch's consented engine.
  const [lockedPdfs, setLockedPdfs] = useState<{ file: File; engine: AiEngine; error?: string }[]>([]);
  const [pdfPassword, setPdfPassword] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [authError, setAuthError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // Render-time engine state for copy and buttons. The authoritative model check for
  // gating happens at pick time (gateBatch); this one just keeps the cards honest.
  const extractionEngine = engineFor("extraction");
  const [localReady, setLocalReady] = useState(false);
  useEffect(() => {
    if (extractionEngine !== "local") return;
    let on = true;
    localModelReady()
      .then((r) => { if (on) setLocalReady(r); })
      .catch(() => { if (on) setLocalReady(false); });
    return () => { on = false; };
  }, [extractionEngine]);

  const hasData = portfolio.holdings.length > 0 || portfolio.accounts.length > 0;
  const [showHow, setShowHow] = useState(false); // "How it works" modal (when data already exists)
  const [confirmDemo, setConfirmDemo] = useState(false);

  // The folder picker is a plain file input with the (non-standard) webkitdirectory
  // attribute — supported by the desktop webview and browsers, no extra permissions.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  // Loading the demo replaces everything, so guard it when real data is present.
  const loadDemo = () => {
    replaceAll(demoPortfolio(portfolio.settings.country));
    setConfirmDemo(false);
  };

  const clearAll = () => { void wipe(); setDrafts([]); setConfirmClear(false); };

  // Override the currency of a parsed draft (e.g. a US statement that came back as INR) —
  // applies to the account and every holding so conversion uses the right rate.
  const setDraftCurrency = (index: number, currency: string) => {
    setDrafts((all) => all.map((p, j) => (j === index ? {
      ...p,
      draft: {
        ...p.draft,
        account: { ...p.draft.account, currency },
        holdings: p.draft.holdings.map((h) => ({ ...h, currency })),
      },
    } : p)));
  };

  // Edit the account-level fields of a draft (name/institution) before saving — the parser's
  // guess is often generic ("Mutual Funds — CAS"); let the user rename it on the review card.
  const updateDraftAccount = (index: number, patch: Partial<ImportDraft["account"]>) =>
    setDrafts((all) => all.map((p, j) => (j === index
      ? { ...p, draft: { ...p.draft, account: { ...p.draft.account, ...patch } } }
      : p)));

  // Edit a single holding inside a draft (fix an AI/parse mislabel before saving).
  const updateDraftHolding = (di: number, hi: number, patch: Partial<ImportDraft["holdings"][number]>) =>
    setDrafts((all) => all.map((p, j) => (j === di
      ? { ...p, draft: { ...p.draft, holdings: p.draft.holdings.map((h, k) => (k === hi ? { ...h, ...patch } : h)) } }
      : p)));
  const removeDraftHolding = (di: number, hi: number) =>
    setDrafts((all) => all.map((p, j) => (j === di ? { ...p, draft: { ...p.draft, holdings: p.draft.holdings.filter((_, k) => k !== hi) } } : p)));

  // Selection from either picker (one file, many files, or a whole folder tree).
  const onPick = (list: FileList | null) => {
    setErrors([]);
    setNeedsClaude([]);
    setSkipped(0);
    const all = list ? Array.from(list) : [];
    if (all.length === 0) return;
    const importable = all.filter(isImportable);
    setSkipped(all.length - importable.length);
    if (importable.length === 0) {
      setErrors(["No importable files found — supported types are CSV, Excel, PDF, and images."]);
      return;
    }
    void gateBatch(importable);
  };

  // Engine-aware consent gate. Nothing that stays on this device needs a warning; anything
  // bound for Claude needs the consent card; the local engine without its model on disk
  // gets a download-or-Claude choice instead of a silent failure.
  const gateBatch = async (files: File[]) => {
    const engine = engineFor("extraction");
    const classes = files.map(classifyFile);
    const ready = engine === "local" && classes.some((c) => c === "ai-text")
      ? await localModelReady().catch(() => false)
      : false;
    const plan = planBatch(classes, engine, ready);
    if (plan === "run") void runBatch(files, engine);
    else if (plan === "confirm") setPendingBatch({ files, engine });
    else setModelGate(files);
  };

  // Process a batch sequentially so progress is visible, cost is predictable, and one bad
  // file never aborts the rest — failures are collected and shown at the end. The whole
  // batch runs under the engine the user consented to (a "use Claude this time" override
  // never touches the saved setting).
  const runBatch = async (files: File[], engine: AiEngine = engineFor("extraction")) => {
    setPendingBatch(null);
    setModelGate(null);
    const errs: string[] = [];
    let done = 0;
    await withExtractionEngine(engine, async () => {
      for (const f of files) {
        setBusy(`Processing ${++done} of ${files.length}: ${f.name}…`);
        try {
          const result = await ingestFile(f);
          setDrafts((d) => [...d, ...wrapDrafts(result)]);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("AI access code")) {
            setAuthError(true);
            break; // Stop batch processing on auth error
          }
          // Unrecognized CSV/Excel → offer the AI fallback rather than just failing.
          if (e instanceof NeedsClaudeError) {
            setNeedsClaude((n) => [...n, { file: e.file, reason: e.message }]);
          } else if (e instanceof PdfPasswordError) {
            // Locked PDF (usually a CAS) → ask for the password, decrypt locally, retry.
            setLockedPdfs((l) => [...l, { file: e.file, engine }]);
          } else {
            errs.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    });
    setBusy(null);
    setErrors(errs);
  };

  // Retry a locked PDF with the supplied password — decryption stays on this device. A CAS
  // then parses fully locally; a non-CAS PDF continues under its batch's consented engine.
  const unlockPdf = async (file: File, engine: AiEngine) => {
    const pw = pdfPassword.trim();
    if (!pw) return;
    setUnlockBusy(true);
    try {
      const result = await withExtractionEngine(engine, () => ingestPdf(file, pw));
      setDrafts((d) => [...d, ...wrapDrafts(result)]);
      setLockedPdfs((l) => l.filter((x) => x.file !== file));
      setPdfPassword("");
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setLockedPdfs((l) => l.map((x) => (x.file === file ? { ...x, error: e.message } : x)));
      } else {
        setLockedPdfs((l) => l.filter((x) => x.file !== file));
        setErrors((er) => [...er, `${file.name}: ${e instanceof Error ? e.message : String(e)}`]);
      }
    } finally {
      setUnlockBusy(false);
    }
  };

  // Opt-in AI fallback for a file local parsing couldn't read — routed to the chosen
  // engine, or forced to Claude when the local model isn't downloaded.
  const parseWithAi = async (file: File, engine: AiEngine = engineFor("extraction")) => {
    setAiBusy(file.name);
    try {
      const result = await withExtractionEngine(engine, () => ingestWithClaude(file));
      setDrafts((d) => [...d, ...wrapDrafts(result)]);
      setNeedsClaude((n) => n.filter((x) => x.file !== file));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("AI access code")) {
        setAuthError(true);
      } else {
        setErrors((er) => [...er, `${file.name} (${engine === "local" ? "on-device AI" : "Claude"}): ${msg}`]);
      }
    } finally {
      setAiBusy(null);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([currentProfile().region === "US" ? CSV_TEMPLATE_US : CSV_TEMPLATE_IN], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sampatti-template.csv";
    a.click();
  };

  return (
    <div className="grid" style={{ gap: "1.25rem" }}>
      {!hasData && <Welcome onDemo={loadDemo} onImport={() => folderRef.current?.click()} />}
      {!hasData && <GettingStarted />}

      {/* Demo + import */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div className="eyebrow" style={{ flex: 1 }}>{hasData ? "Add more" : "Get started"}</div>
          {hasData && (
            <button onClick={() => setShowHow(true)}
              style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", font: "inherit", fontSize: "0.8rem" }}>
              📖 How it works
            </button>
          )}
        </div>
        <h2 style={{ fontSize: "1.3rem", margin: "0.2rem 0 0.9rem" }}>Bring in your portfolio</h2>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          {hasData && (
            confirmDemo ? (
              <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center", background: "var(--surface-2)", padding: "0.4rem 0.75rem", borderRadius: "10px", border: "1px solid var(--line)" }}>
                <span className="muted" style={{ fontSize: "0.8rem" }}>Overwrite existing data?</span>
                <button className="btn btn-danger" style={{ padding: "0.2rem 0.6rem", fontSize: "0.75rem" }} onClick={loadDemo}>Yes, replace</button>
                <button className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }} onClick={() => setConfirmDemo(false)}>Cancel</button>
              </span>
            ) : (
              <button className="btn" onClick={() => setConfirmDemo(true)}>▶ Load demo portfolio</button>
            )
          )}
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
          Pick several files or a whole folder of statements at once. {currentProfile().region === "US"
            ? <>CSV and Excel files are parsed entirely on this device;{" "}</>
            : <>CSV, Excel and{" "}
          <strong>CAS PDFs (CAMS/KFintech &amp; NSDL/CDSL)</strong> — password and all — are parsed entirely on this
          device;{" "}</>}
          {extractionEngine === "local" && localReady
            ? <>other PDFs are read by the <strong>on-device model</strong>, so they never leave this
              computer either. Screenshots still use Claude (you'll confirm those first).</>
            : <>other PDFs and screenshots are read with Claude (you'll confirm the batch first).</>}{" "}
          If a layout can't be read automatically, you'll be offered an AI option. Unsupported
          files are skipped.
        </p>
        {busy && <div style={{ marginTop: "0.7rem" }}><span className="spinner" /> <span className="muted">{busy}</span></div>}
        {!busy && skipped > 0 && !pendingBatch && !modelGate && (
          <div className="muted" style={{ marginTop: "0.7rem", fontSize: "0.78rem" }}>
            {skipped} unsupported file{skipped > 1 ? "s" : ""} skipped.
          </div>
        )}
        {errors.length > 0 && (
          <div className="badge badge-rose" style={{ marginTop: "0.7rem", padding: "0.4rem 0.7rem", display: "block" }}>
            {errors.map((er, i) => <div key={i} style={{ padding: "0.1rem 0" }}>{er}</div>)}
          </div>
        )}
      {hasData && (
        <div style={{ marginTop: "0.9rem", paddingTop: "0.8rem", borderTop: "1px solid var(--line-2)", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {confirmClear ? (
            <>
              <span className="muted" style={{ fontSize: "0.8rem" }}>Erase all accounts, holdings &amp; income and start fresh?</span>
              <button className="btn btn-danger" onClick={clearAll}>Yes, clear everything</button>
              <button className="btn btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirmClear(true)}>🗑 Clear all data &amp; start fresh</button>
          )}
        </div>
      )}
    </div>

    {/* The Import Workflow Modal — handles consent, passwords, AI fallback, and draft review in one place */}
    {(drafts.length > 0 || lockedPdfs.length > 0 || needsClaude.length > 0 || pendingBatch || modelGate) && (
      <div className="modal-backdrop">
        <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label="Import workflow"
          style={{ maxHeight: "90vh", display: "flex", flexDirection: "column", padding: "1.25rem" }}>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
            <h3 style={{ fontSize: "1.15rem", margin: 0 }}>
              {drafts.length > 0 ? "Review imports" : "Importing statements"}
            </h3>
            <button className="btn btn-ghost" aria-label="Close" onClick={() => {
              setDrafts([]); setLockedPdfs([]); setNeedsClaude([]); setPendingBatch(null); setModelGate(null);
            }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {/* 1. Batch Consent */}
            {pendingBatch && (() => {
              const { files, engine } = pendingBatch;
              const claudeFiles = filesForClaude(files, classifyFile, engine);
              const localCount = files.length - claudeFiles.length;
              const n = files.length;
              return (
                <div className="card" style={{ borderColor: "var(--line)", background: "var(--primary-soft)", margin: 0 }}>
                  <h3 style={{ fontSize: "1rem" }}>Import {n} file{n > 1 ? "s" : ""}?</h3>
                  <ul className="muted" style={{ fontSize: "0.84rem", margin: "0.4rem 0 0.8rem", paddingLeft: "1.1rem", lineHeight: 1.7 }}>
                    {localCount > 0 && (
                      <li>
                        <strong>{localCount}</strong> parsed on this device{engine === "local" ? " (spreadsheets, CAS & text PDFs)" : " (CSV/Excel)"} — never sent anywhere.
                      </li>
                    )}
                    {claudeFiles.length > 0 && (
                      <li>
                        <strong>{claudeFiles.length}</strong>{" "}
                        {engine === "local" ? "images/scans " : ""}sent to Claude{" "}
                        {portfolio.settings.claudeMode === "byo" ? "with your own API key" : "via the relay"}
                        {engine === "local" ? " — the on-device model reads text only —" : ""}{" "}
                        to extract holdings — not stored.
                      </li>
                    )}
                    {skipped > 0 && <li>{skipped} unsupported file{skipped > 1 ? "s" : ""} skipped.</li>}
                  </ul>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="btn btn-primary" onClick={() => void runBatch(files, engine)}>Import {n} file{n > 1 ? "s" : ""}</button>
                    <button className="btn btn-ghost" onClick={() => { setPendingBatch(null); setSkipped(0); }}>Cancel</button>
                  </div>
                </div>
              );
            })()}

            {/* 2. Model Download Gate */}
            {modelGate && (() => {
              const aiCount = modelGate.filter((f) => classifyFile(f) !== "local").length;
              return (
                <div className="card" style={{ borderLeft: "3px solid var(--primary)", background: "var(--primary-soft)", margin: 0 }}>
                  <h3 style={{ fontSize: "1rem" }}>🔒 On-device AI model needed</h3>
                  <p className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0.8rem" }}>
                    {aiCount} file{aiCount === 1 ? "" : "s"} need AI to read, and your engine is set to on-device —
                    but the model isn't downloaded yet.
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {onConfigure && <button className="btn btn-primary" onClick={() => onConfigure()}>Download the model</button>}
                    <button className="btn" onClick={() => { const files = modelGate; setModelGate(null); setPendingBatch({ files, engine: "claude" }); }}>✨ Use Claude this time</button>
                    <button className="btn btn-ghost" onClick={() => { setModelGate(null); setSkipped(0); }}>Cancel</button>
                  </div>
                </div>
              );
            })()}

            {/* 3. Password Protected PDFs */}
            {lockedPdfs.map(({ file, engine, error }, i) => (
              <div key={`lock-${i}`} className="card" style={{ borderLeft: "3px solid var(--primary)", background: "var(--primary-soft)", margin: 0 }}>
                <h3 style={{ fontSize: "0.98rem" }}>🔒 {file.name} is password-protected</h3>
                <p className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0.7rem" }}>
                  Enter the password (usually your PAN in capitals for a CAS). Decrypted entirely on this device.
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="password" placeholder="PDF password" value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void unlockPdf(file, engine)}
                  />
                  <button className="btn btn-primary" disabled={unlockBusy || !pdfPassword.trim()} onClick={() => void unlockPdf(file, engine)}>
                    {unlockBusy ? <span className="spinner" /> : "Unlock"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setLockedPdfs((l) => l.filter((x) => x.file !== file))}>Skip</button>
                </div>
                {error && <div className="badge badge-rose" style={{ marginTop: "0.55rem" }}>{error}</div>}
              </div>
            ))}

            {/* 4. AI Fallback Offers */}
            {needsClaude.map(({ file, reason }, i) => {
              const localBlocked = extractionEngine === "local" && !localReady;
              return (
                <div key={i} className="card" style={{ borderLeft: "3px solid var(--amber, #d98324)", background: "var(--amber-soft)", margin: 0 }}>
                  <h3 style={{ fontSize: "0.98rem" }}>Couldn't auto-read {file.name}</h3>
                  <p className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0.7rem" }}>
                    {reason} Send it to Claude to extract holdings?
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <button className="btn btn-primary" disabled={aiBusy === file.name} onClick={() => void parseWithAi(file, localBlocked ? "claude" : undefined)}>
                      {aiBusy === file.name ? <span className="spinner" /> : "✨ Parse with Claude"}
                    </button>
                    <button className="btn btn-ghost" onClick={() => setNeedsClaude((n) => n.filter((x) => x.file !== file))}>Skip</button>
                  </div>
                </div>
              );
            })}

            {/* 5. Draft Review Cards */}
            {drafts.map((p, i) => (
              <DraftReview
                key={p.key} draft={p.draft}
                accounts={portfolio.accounts}
                existingHoldings={portfolio.holdings}
                onCurrency={(c) => setDraftCurrency(i, c)}
                onAccount={(patch) => updateDraftAccount(i, patch)}
                onHolding={(hi, patch) => updateDraftHolding(i, hi, patch)}
                onRemoveHolding={(hi) => removeDraftHolding(i, hi)}
                onApply={(target, money) => {
                  if (target === "new") addDraft(p.draft, "new", money);
                  else mergeDraftInto(target, p.draft);
                  setDrafts((all) => all.filter((x) => x.key !== p.key));
                }}
                onDiscard={() => setDrafts((all) => all.filter((x) => x.key !== p.key))}
              />
            ))}
          </div>

          <div style={{ marginTop: "1rem", paddingTop: "0.8rem", borderTop: "1px solid var(--line-2)", textAlign: "right" }}>
            <button className="btn" onClick={() => {
              setDrafts([]); setLockedPdfs([]); setNeedsClaude([]); setPendingBatch(null); setModelGate(null);
            }}>{drafts.length > 0 ? "Finish" : "Close"}</button>
          </div>
        </div>
      </div>
    )}

    <ManualAccount usdInr={portfolio.settings.usdInr} onAdd={(acct, holdings, money, loanAmount) => {
        const id = addAccount(acct);
        for (const h of holdings) addHolding({ ...h, accountId: id }, money);
        // A remaining loan becomes a paired liability account so net worth nets it out.
        if (loanAmount && loanAmount > 0) {
          const loanId = addAccount({ ...acct, name: `${acct.name} — loan`, accountType: "liability", taxTreatment: "na" });
          addHolding({ name: "Loan outstanding", assetClass: "other", marketValue: loanAmount, currency: acct.currency, accountId: loanId }, "tracking");
        }
      }} />

      <IncomeForm onAdd={addIncome} />

      {authError && <AuthErrorModal onClose={() => setAuthError(false)} onConfigure={onConfigure} />}

      {showHow && (
        <div className="modal-backdrop" onClick={() => setShowHow(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="How it works" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
              <h3 style={{ fontSize: "1.15rem", margin: 0 }}>How it works, step by step</h3>
              <button className="btn btn-ghost" aria-label="Close" onClick={() => setShowHow(false)}>✕</button>
            </div>
            <GettingStarted expanded />
          </div>
        </div>
      )}
    </div>
  );
}
