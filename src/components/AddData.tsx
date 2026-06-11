import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { keyStoreName } from "../platform";
import { demoPortfolio } from "../demo";
import { classifyFile, ingestFile, ingestPdf, ingestWithClaude, isImportable, NeedsClaudeError, PdfPasswordError } from "../ingest";
import { filesForClaude, planBatch } from "../ingest/consent";
import { findCrossAccountDuplicates } from "../ingest/reconcile";
import { engineFor, localModelStatus, withExtractionEngine } from "../ai/engine";
import { inr } from "../domain/format";
import {
  ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL,
} from "../domain/classify";
import { findMatchingAccount } from "../domain/types";
import { fetchGoldPerGramInr } from "../domain/gold";
import type {
  Account, AccountType, AiEngine, AssetClass, FlowKind, Holding, ImportDraft, IncomeKind, Region, TaxTreatment,
} from "../domain/types";

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];
const ASSET_CLASSES = Object.keys(ASSET_CLASS_LABEL) as AssetClass[];
const TAX_TYPES = Object.keys(TAX_LABEL) as TaxTreatment[];
const REGIONS: Region[] = ["India", "US", "Other"];
const INCOME_KINDS: IncomeKind[] = ["salary", "rent", "business", "dividend", "interest", "other"];
const isGold = (c: AssetClass) => c === "gold_sgb" || c === "gold_other";

const CSV_TEMPLATE =
  "account,institution,account_type,tax_treatment,region,currency,symbol,name,asset_class,units,market_value,cost_basis,buy_date,as_of\n" +
  "Zerodha Demat,Zerodha,demat,taxable,India,INR,RELIANCE,Reliance Industries,indian_equity,1180,3500000,2100000,2019-07-12,2026-05-31\n" +
  "Equity MF,CAMS,mutual_fund,taxable,India,INR,,Parag Parikh Flexi Cap,equity_mf,,5500000,3000000,2019-04-01,2026-05-31\n" +
  "PPF,SBI,epf_ppf,eee_exempt,India,INR,,PPF account,epf_ppf,,2800000,,,2026-03-31\n";

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
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // Render-time engine state for copy and buttons. The authoritative model check for
  // gating happens at pick time (gateBatch); this one just keeps the cards honest.
  const extractionEngine = engineFor("extraction");
  const [localReady, setLocalReady] = useState(false);
  useEffect(() => {
    if (extractionEngine !== "local") return;
    let on = true;
    localModelStatus()
      .then((s) => { if (on) setLocalReady(s.state === "ready"); })
      .catch(() => { if (on) setLocalReady(false); });
    return () => { on = false; };
  }, [extractionEngine]);

  const hasData = portfolio.holdings.length > 0 || portfolio.accounts.length > 0;

  // The folder picker is a plain file input with the (non-standard) webkitdirectory
  // attribute — supported by the desktop webview and browsers, no extra permissions.
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  // Loading the demo replaces everything, so guard it when real data is present — this is
  // how the demo used to get mixed into a real portfolio.
  const loadDemo = () => {
    if (hasData && !window.confirm("Replace your current data with the sample demo portfolio? This clears what's there now.")) return;
    replaceAll(demoPortfolio());
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
      ? await localModelStatus().then((s) => s.state === "ready").catch(() => false)
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
      setErrors((er) => [...er, `${file.name} (${engine === "local" ? "on-device AI" : "Claude"}): ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setAiBusy(null);
    }
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
      {!hasData && <Welcome onDemo={loadDemo} onImport={() => folderRef.current?.click()} />}
      <GettingStarted />

      {/* Demo + import */}
      <div className="card">
        <div className="eyebrow">{hasData ? "Add more" : "Get started"}</div>
        <h2 style={{ fontSize: "1.3rem", margin: "0.2rem 0 0.9rem" }}>Bring in your portfolio</h2>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          {hasData && <button className="btn" onClick={loadDemo}>▶ Load demo portfolio (₹14 Cr)</button>}
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
          Pick several files or a whole folder of statements at once. CSV, Excel and{" "}
          <strong>CAS PDFs (CAMS/KFintech &amp; NSDL/CDSL)</strong> — password and all — are parsed entirely on this
          device;{" "}
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

      {/* Password-protected PDFs (usually a CAS) — unlock & parse on this device */}
      {lockedPdfs.map(({ file, engine, error }, i) => (
        <div key={`lock-${i}`} className="card" style={{ borderLeft: "3px solid var(--primary)", background: "linear-gradient(135deg,#f3f1ff,#fff)" }}>
          <h3 style={{ fontSize: "0.98rem" }}>🔒 {file.name} is password-protected</h3>
          <p className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0.7rem", maxWidth: 560 }}>
            For a CAS this is usually <strong>your PAN in capital letters</strong> or the password
            you chose when requesting it. The file is decrypted and read <strong>on this device
            only</strong> — a CAS never goes to Claude, and the password is never stored.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", maxWidth: 420 }}>
            <input
              type="password" placeholder="PDF password" value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void unlockPdf(file, engine)}
            />
            <button className="btn btn-primary" disabled={unlockBusy || !pdfPassword.trim()} onClick={() => void unlockPdf(file, engine)}>
              {unlockBusy ? <span className="spinner" /> : "Unlock & import"}
            </button>
            <button className="btn btn-ghost" onClick={() => setLockedPdfs((l) => l.filter((x) => x.file !== file))}>Skip</button>
          </div>
          {error && <div className="badge badge-rose" style={{ marginTop: "0.55rem", padding: "0.3rem 0.6rem" }}>{error}</div>}
        </div>
      ))}

      {/* Files local parsing couldn't read — offer the AI fallback, per file */}
      {needsClaude.map(({ file, reason }, i) => {
        const localBlocked = extractionEngine === "local" && !localReady;
        return (
          <div key={i} className="card" style={{ borderLeft: "3px solid var(--amber, #d98324)", background: "linear-gradient(135deg,#fff8ec,#fff)" }}>
            <h3 style={{ fontSize: "0.98rem" }}>Couldn't auto-read {file.name}</h3>
            <p className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0.7rem" }}>
              {reason}{" "}
              {extractionEngine === "local"
                ? (localBlocked
                  ? "Your import engine is set to on-device AI, but the model isn't downloaded yet (Privacy → AI engines). Send just this file to Claude instead, or skip it."
                  : "Parse it with the on-device model — nothing leaves this device — or skip it. You'll review the result before saving.")
                : `Send it to Claude ${portfolio.settings.claudeMode === "byo" ? "with your own key" : "via the relay"} to extract the holdings — you'll review the result before saving — or skip it.`}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button className="btn btn-primary" disabled={aiBusy === file.name} onClick={() => void parseWithAi(file, localBlocked ? "claude" : undefined)}>
                {aiBusy === file.name
                  ? <span className="spinner" />
                  : localBlocked ? "✨ Parse with Claude instead" : extractionEngine === "local" ? "🔒 Parse on this device" : "✨ Parse with Claude"}
              </button>
              <button className="btn btn-ghost" onClick={() => setNeedsClaude((n) => n.filter((x) => x.file !== file))}>Skip</button>
            </div>
          </div>
        );
      })}

      {/* Confirm the batch before any document is sent to Claude. Only files that actually
          LEAVE the device are listed as going to Claude — under the local engine that is
          just the images; text files stay here and never gate. */}
      {pendingBatch && (() => {
        const { files, engine } = pendingBatch;
        const claudeFiles = filesForClaude(files, classifyFile, engine);
        const localCount = files.length - claudeFiles.length;
        const n = files.length;
        return (
          <div className="card" style={{ borderColor: "#e0e0ff", background: "linear-gradient(135deg,#f3f1ff,#fff)" }}>
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
                  to extract holdings — not stored. You'll review each before saving.
                </li>
              )}
              {skipped > 0 && <li>{skipped} unsupported file{skipped > 1 ? "s" : ""} skipped.</li>}
            </ul>
            {claudeFiles.length > 0 && (
              <details style={{ marginBottom: "0.7rem" }}>
                <summary className="muted" style={{ fontSize: "0.78rem", cursor: "pointer" }}>
                  Show the {claudeFiles.length} file{claudeFiles.length > 1 ? "s" : ""} going to Claude
                </summary>
                <div className="muted" style={{ fontSize: "0.76rem", marginTop: "0.3rem", maxHeight: 140, overflow: "auto" }}>
                  {claudeFiles.map((f, i) => <div key={i}>• {f.name}</div>)}
                </div>
              </details>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary" onClick={() => void runBatch(files, engine)}>Import {n} file{n > 1 ? "s" : ""}</button>
              <button className="btn btn-ghost" onClick={() => { setPendingBatch(null); setSkipped(0); }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* Local engine selected but the model isn't on disk — choose: download it (Privacy)
          or send this batch to Claude just this once. Nothing runs until they choose. */}
      {modelGate && (() => {
        const aiCount = modelGate.filter((f) => classifyFile(f) !== "local").length;
        return (
          <div className="card" style={{ borderLeft: "3px solid var(--primary)", background: "linear-gradient(135deg,#f3f1ff,#fff)" }}>
            <h3 style={{ fontSize: "1rem" }}>🔒 On-device AI is selected — but the model isn't downloaded</h3>
            <p className="muted" style={{ fontSize: "0.82rem", margin: "0.3rem 0 0.8rem", maxWidth: 600 }}>
              {aiCount} of these {modelGate.length} file{modelGate.length > 1 ? "s" : ""} need{aiCount === 1 ? "s" : ""} AI
              to read, and your import engine is set to the on-device model (Privacy → AI engines) —
              but the model isn't on this computer yet. Download it once and imports stay fully
              private, or send {aiCount === 1 ? "this file" : "these files"} to Claude just this time.
              Your saved setting doesn't change either way.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {onConfigure && (
                <button className="btn btn-primary" onClick={() => onConfigure()}>⬇ Download the model (Privacy)</button>
              )}
              <button className="btn" onClick={() => { const files = modelGate; setModelGate(null); setPendingBatch({ files, engine: "claude" }); }}>
                ✨ Use Claude this time
              </button>
              <button className="btn btn-ghost" onClick={() => { setModelGate(null); setSkipped(0); }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* Draft review — keyed by a STABLE id (p.key), never the array index */}
      {drafts.map((p, i) => (
        <DraftReview
          key={p.key} draft={p.draft}
          accounts={portfolio.accounts}
          existingHoldings={portfolio.holdings}
          onCurrency={(c) => setDraftCurrency(i, c)}
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

      <ManualAccount usdInr={portfolio.settings.usdInr} onAdd={(acct, holdings, money) => {
        const id = addAccount(acct);
        for (const h of holdings) addHolding({ ...h, accountId: id }, money);
      }} />

      <IncomeForm onAdd={addIncome} />
    </div>
  );
}

// ---- first-run welcome ----
// The first thing a brand-new user sees. The audience has no finance/computer vocabulary,
// so this screen makes exactly ONE ask — try the sample, or bring your own files — and
// keeps the step-by-step under a collapsed "How it works".
function Welcome({ onDemo, onImport }: { onDemo: () => void; onImport: () => void }) {
  return (
    <div className="card card-pad-lg" style={{ textAlign: "center", padding: "2.6rem 1.5rem" }}>
      <div className="eyebrow">Welcome</div>
      <h1 style={{ fontSize: "1.9rem", margin: "0.35rem 0 0.5rem" }}>All your money, in one private picture</h1>
      <p className="muted" style={{ maxWidth: 520, margin: "0 auto 1.5rem", fontSize: "0.95rem", lineHeight: 1.6 }}>
        Stocks, mutual funds, PF, FDs, property, gold — added up, explained in plain words, and
        reviewed by AI when you ask. Everything stays on this computer; nothing is uploaded.
      </p>
      <div style={{ display: "flex", gap: "0.7rem", justifyContent: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ fontSize: "0.95rem", padding: "0.7rem 1.4rem" }} onClick={onDemo}>
          ▶ Load demo portfolio — see it working first
        </button>
        <button className="btn" style={{ fontSize: "0.95rem", padding: "0.7rem 1.4rem" }} onClick={onImport}>
          📁 Add my own statements
        </button>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.9rem" }}>
        The demo is a made-up ₹14 Cr portfolio with 18 months of history — play freely, then clear it with one click.
      </p>
    </div>
  );
}

// ---- first-run guide ----
// The full guide also lives at github.com/miteshs/sampatti-releases (and docs/getting-started.md);
// this is the in-app version, self-contained because the webview doesn't open external links.
// Plain words on purpose: the reader may have never used anything beyond WhatsApp and
// net banking. Collapsed by default — the Welcome card above carries the first ask.
function GettingStarted() {
  const [open, setOpen] = useState(false);
  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", gap: "0.7rem", alignItems: "baseline" }}>
      <span style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: "var(--primary-soft)",
        color: "var(--primary)", fontSize: "0.74rem", fontWeight: 700, display: "inline-flex",
        alignItems: "center", justifyContent: "center", transform: "translateY(3px)",
      }}>{n}</span>
      <div>
        <span style={{ fontWeight: 650 }}>{title}</span>{" "}
        <span className="muted" style={{ fontSize: "0.84rem", lineHeight: 1.55 }}>{children}</span>
      </div>
    </div>
  );
  return (
    <details className="card" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span className="eyebrow" style={{ flex: 1 }}>📖 How it works, step by step</span>
        <span className="muted" style={{ fontSize: "0.78rem" }}>{open ? "hide" : "show"}</span>
      </summary>
      <div className="grid" style={{ gap: "0.65rem", marginTop: "0.9rem" }}>
        <Step n={1} title="Collect a statement from each place your money lives.">
          <strong>Fastest start:</strong> your monthly <strong>NSDL/CDSL CAS email</strong> has every demat stock AND fund; for purchase costs request the detailed CAS at camsonline.com (Statements → CAS). Both are read entirely on this computer.
          For everything else, download the holdings statement — Excel or CSV is best (also read
          on this computer), and PDFs or screenshots work too. Put them all in one folder.
        </Step>
        <Step n={2} title="Import that folder here.">
          Every statement becomes a card for you to check — the account name, the amounts,
          anything that looks off. Nothing is saved until you approve each card. Import a newer
          statement next month and it updates that account instead of duplicating it.
        </Step>
        <Step n={3} title="Add the rest by hand.">
          Your house, PF, FDs, insurance, gold — and any loans, so the total is honest. There's
          a simple form below; everything can be edited later on the Manage tab.
        </Step>
        <Step n={4} title="Bring values up to today.">
          Manage → Refresh live prices. The app also quietly records your net worth every day
          you open it, so a personal history chart builds itself.
        </Step>
        <Step n={5} title="Connect Claude for the AI review (Privacy tab).">
          Paste your Claude key there once — the screen shows where to get it. It's stored in
          the {keyStoreName()} on this computer and used only when you ask for an analysis.
        </Step>
        <Step n={6} title="Ask anything, in your own words.">
          Run the analysis, then ask questions like “am I too dependent on one stock?” —
          only a small summary of totals and percentages is ever sent, never your statements.
          You can preview exactly what goes before anything is sent.
        </Step>
      </div>
    </details>
  );
}

// ---- review an AI/file draft before saving ----
// "Apply to" lets the user steer the re-import: auto-matched accounts (same institution+name)
// are preselected to Update; otherwise they can still pick any existing account to overwrite,
// or add as a new one. Updating replaces that account's holdings wholesale (items sold since
// the last statement simply drop off; new items are added).
function DraftReview({ draft, accounts, existingHoldings, onCurrency, onHolding, onRemoveHolding, onApply, onDiscard }: {
  draft: ImportDraft; accounts: Account[]; existingHoldings: Holding[]; onCurrency: (currency: string) => void;
  onHolding: (hi: number, patch: Partial<ImportDraft["holdings"][number]>) => void;
  onRemoveHolding: (hi: number) => void;
  onApply: (target: "new" | string, money: FlowKind) => void; onDiscard: () => void;
}) {
  const total = draft.holdings.reduce((s, h) => s + h.marketValue, 0);
  const fmt = (v: number) => draft.account.currency === "INR" ? inr(v) : `${draft.account.currency} ${v.toLocaleString("en-US")}`;
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
          <h3 style={{ fontSize: "1.05rem", marginTop: "0.15rem" }}>{draft.account.name}</h3>
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            {draft.account.institution} · {ACCOUNT_TYPE_LABEL[draft.account.accountType]} ·{" "}
            {TAX_LABEL[draft.account.taxTreatment]} · {draft.account.region}
            {draft.account.asOf ? ` · as of ${draft.account.asOf}` : ""}
          </div>
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
                    {ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
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

// ---- manual account + holdings entry ----
function ManualAccount({ onAdd, usdInr }: {
  onAdd: (a: ImportDraft["account"], h: ImportDraft["holdings"], money: FlowKind) => void;
  usdInr: number;
}) {
  const [a, setA] = useState<ImportDraft["account"]>({
    name: "", institution: "", accountType: "demat", taxTreatment: "taxable",
    region: "India", currency: "INR", asOf: new Date().toISOString().slice(0, 10),
  });
  const [money, setMoney] = useState<FlowKind>("tracking"); // pre-owned by default — see DraftReview
  const [hName, setHName] = useState("");
  const [hClass, setHClass] = useState<AssetClass>("indian_equity");
  const [hValue, setHValue] = useState("");
  const [hBasis, setHBasis] = useState(""); // optional purchase cost
  const [hGrams, setHGrams] = useState("");
  const [goldPrice, setGoldPrice] = useState<number | null>(null);
  const [goldBusy, setGoldBusy] = useState(false);
  const [holdings, setHoldings] = useState<ImportDraft["holdings"]>([]);

  // For gold, value comes from weight × the live ₹/gram rate, fetched when a gold class is
  // picked (and editable afterwards — e.g. for 22K or a dealer quote).
  useEffect(() => {
    if (!isGold(hClass)) return;
    setGoldBusy(true);
    void fetchGoldPerGramInr(usdInr).then((p) => { setGoldPrice((prev) => p ?? prev); setGoldBusy(false); });
  }, [hClass, usdInr]);

  const goldValue = isGold(hClass) && goldPrice ? Math.round((Number(hGrams.replace(/[,\s]/g, "")) || 0) * goldPrice) : 0;

  // A holding typed into the item fields but not yet added with "+ Add item".
  const pendingHolding = (): ImportDraft["holdings"][number] | null => {
    if (!hName.trim()) return null;
    const basis = Number(hBasis.replace(/[₹,\s]/g, "")) || undefined; // optional
    if (isGold(hClass)) {
      const g = Number(hGrams.replace(/[,\s]/g, ""));
      if (!g || !goldPrice) return null;
      return { name: hName.trim(), assetClass: hClass, marketValue: Math.round(g * goldPrice), units: g, costBasis: basis, currency: a.currency };
    }
    const v = Number(hValue.replace(/[₹,\s]/g, ""));
    return v ? { name: hName.trim(), assetClass: hClass, marketValue: v, costBasis: basis, currency: a.currency } : null;
  };
  const addH = () => {
    const h = pendingHolding();
    if (!h) return;
    setHoldings((all) => [...all, h]);
    setHName(""); setHValue(""); setHBasis(""); setHGrams("");
  };
  // Save folds in a typed-but-unadded holding so the form doesn't silently refuse to save.
  const canSave = !!a.name.trim() && (holdings.length > 0 || pendingHolding() != null);
  const save = () => {
    const extra = pendingHolding();
    const all = extra ? [...holdings, extra] : holdings;
    if (!a.name.trim() || all.length === 0) return;
    onAdd(a, all, money);
    setA({ ...a, name: "", institution: "" });
    setHoldings([]); setHName(""); setHValue(""); setHBasis(""); setHGrams("");
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
        {isGold(hClass) ? (
          <>
            <div style={{ flex: "1 1 100px" }}><label>Weight (grams)</label><input value={hGrams} onChange={(e) => setHGrams(e.target.value)} placeholder="50" inputMode="decimal" /></div>
            <div style={{ flex: "1 1 130px" }}><label>₹/gram (24K, live)</label>
              <input value={goldPrice ?? ""} onChange={(e) => setGoldPrice(Number(e.target.value) || null)} placeholder={goldBusy ? "fetching…" : "price"} inputMode="decimal" />
            </div>
          </>
        ) : (
          <>
            <div style={{ flex: "1 1 130px" }}><label>Value ({a.currency})</label><input value={hValue} onChange={(e) => setHValue(e.target.value)} placeholder="2500000" /></div>
            <div style={{ flex: "1 1 130px" }}><label>Invested (optional)</label><input value={hBasis} onChange={(e) => setHBasis(e.target.value)} placeholder="purchase cost" inputMode="decimal" /></div>
          </>
        )}
        <button className="btn" onClick={addH}>+ Add item</button>
      </div>
      {isGold(hClass) && (
        <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>
          {goldBusy && goldPrice == null ? "Fetching the live gold price…" : goldPrice ? (
            <>Live 24K gold ≈ <strong>₹{goldPrice.toLocaleString("en-IN")}/g</strong>
              {goldValue > 0 && <> · {hGrams}g = <strong>{inr(goldValue)}</strong></>}
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
                <td className="num" style={{ fontWeight: 600 }}>{inr(h.marketValue)}</td>
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
