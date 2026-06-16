// Configuration lives here (⚙), organised by what the user is actually deciding:
//   1. AI analysis   — how the review reaches Claude (relay / own key) + which model writes it
//   2. Region & currency
//   3. Appearance     — light / dark
//   4. Insights       — optional Overview extras
//   5. Developer mode — experimental toggle… which reveals
//   6. AI engines     — the on-device engine (only when developer mode is on)
// The Privacy tab stays a pure explainer + data controls — the two are deliberately not mixed.
import { useEffect, useRef, useState } from "react";
import { useStore, exportPortfolio } from "../storage/store";
import { clearByoKey, hasByoKey, setByoKey, isTauri } from "../platform";
import { ANALYSIS_MODELS } from "../claude/transport";
import { localModelDownload, localModelRemove, localModelStatus, type LocalModelStatus } from "../ai/engine";
import type { AiEngine } from "../domain/types";
import { fetchUsdInr } from "../domain/fx";
import { profileFor } from "../regions/profile";
import { PrivacyExplainer } from "./Privacy";
import { checkForUpdate } from "../updater";

const H3 = { fontSize: "1.05rem", marginBottom: "0.3rem" } as const;

export function Settings() {
  const { portfolio, updateSettings, wipe, importBackup } = useStore();
  const backupRef = useRef<HTMLInputElement>(null);
  const s = portfolio.settings;
  const [keyInput, setKeyInput] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [confirmDev, setConfirmDev] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ text: string; name: string } | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const runUpdateCheck = async () => {
    setUpdating(true);
    setUpdateMsg("Checking…");
    try {
      const upd = await checkForUpdate();
      if (!upd) {
        setUpdateMsg("You're on the latest version.");
        setUpdating(false);
        return;
      }
      setUpdateMsg(`Update ${upd.version} found — downloading…`);
      await upd.install((pct, phase) =>
        setUpdateMsg(phase === "installing" ? "Installing — the app will restart…" : `Downloading… ${pct}%`),
      );
      // install() relaunches the app on success; reaching here means it's restarting.
    } catch (e) {
      setUpdateMsg(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
      setUpdating(false);
    }
  };
  // Region is a once-at-the-start choice: switching reframes the whole app (display currency,
  // tax buckets, manual-entry pickers, analyst persona). It never converts away data — values
  // are stored in a neutral unit (see THE UNIT RULE in regions/profile) — so this is a confirm,
  // not a hard lock. Freely switchable while empty; gated once there's a portfolio to reframe.
  const hasData = portfolio.holdings.length > 0 || portfolio.accounts.length > 0;
  const [pendingRegion, setPendingRegion] = useState<"India" | "US" | null>(null);
  const applyRegion = (c: "India" | "US") => {
    updateSettings({ country: c, baseCurrency: c === "US" ? "USD" : "INR" });
    setPendingRegion(null);
  };

  const doExport = async () => {
    try {
      const dest = await exportPortfolio(portfolio);
      if (dest) setExportNote(`Saved to ${dest}`);
    } catch (e) {
      setExportNote(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // Importing a backup REPLACES the current portfolio — confirm first when there's data to lose.
  const onPickBackup = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const hasData = portfolio.holdings.length > 0 || portfolio.accounts.length > 0;
    if (hasData) { setPendingImport({ text, name: file.name }); return; }
    runImport(text, file.name);
  };
  const runImport = (text: string, name: string) => {
    try {
      importBackup(text);
      setExportNote(`Restored backup · ${name}`);
    } catch (e) {
      setExportNote(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setPendingImport(null);
  };
  const [fxBusy, setFxBusy] = useState(false);
  const [fxNote, setFxNote] = useState<string | null>(null);
  const [model, setModel] = useState<LocalModelStatus | null>(null);
  const [dlProgress, setDlProgress] = useState<number | null>(null); // 0..1 while downloading
  const [modelErr, setModelErr] = useState<string | null>(null);

  const refreshModel = async () => {
    if (!isTauri()) return;
    try { setModel(await localModelStatus()); } catch { /* command absent in old builds */ }
  };

  const downloadModel = async () => {
    setModelErr(null);
    setDlProgress(0);
    try {
      await localModelDownload((received, total) => setDlProgress(total ? received / total : 0));
      await refreshModel();
    } catch (e) {
      setModelErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDlProgress(null);
    }
  };

  const removeModel = async () => {
    setModelErr(null);
    try {
      await localModelRemove();
      // Local engine without a model is pointless — fall anything local back to Claude.
      updateSettings({ ai: { extraction: "claude", analysis: "claude" } });
      await refreshModel();
    } catch (e) {
      setModelErr(e instanceof Error ? e.message : String(e));
    }
  };

  const setEngine = (task: "extraction" | "analysis", engine: AiEngine) =>
    updateSettings({ ai: { ...s.ai, [task]: engine } });

  const refreshRate = async () => {
    setFxBusy(true);
    setFxNote(null);
    const rate = await fetchUsdInr();
    setFxBusy(false);
    if (rate) {
      updateSettings({ usdInr: rate });
      setFxNote(`Updated to ₹${rate}/$ just now.`);
    } else {
      setFxNote("Couldn't reach the rate service — keeping the current rate.");
    }
  };

  useEffect(() => {
    void hasByoKey().then(setKeySet);
    void refreshModel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    await setByoKey(keyInput.trim());
    setKeyInput("");
    setKeySet(true);
    updateSettings({ byoKeySet: true, claudeMode: "byo" });
  };
  const removeKey = async () => {
    await clearByoKey();
    setKeySet(false);
    updateSettings({ byoKeySet: false, claudeMode: "relay" });
  };

  return (
    <div className="grid" style={{ gap: "1.1rem", maxWidth: 760 }}>
      {/* ── 1. AI analysis: how the review reaches Claude + which model writes it ── */}
      <div className="card">
        <h3 style={H3}>AI analysis</h3>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.8rem", maxWidth: 600 }}>
          Configure how the analyst reviews your portfolio. Data stays on your device — only a
          compact brief is sent for review.
        </p>

        {/* Access Code Section */}
        {!s.developerMode && (
          <div className="list-grouped" style={{ border: "1px solid var(--line-2)", marginBottom: "1.25rem" }}>
            <div className="form-col" style={{ padding: "0.5rem 0.8rem" }}>
              <label style={{ marginBottom: "0.15rem" }}>Access code</label>
              <input
                type="password" aria-label="Access code"
                placeholder="paste your invite code"
                value={s.relayCode ?? ""}
                onChange={(e) => updateSettings({ relayCode: e.target.value })}
                style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }}
              />
            </div>
          </div>
        )}

        {/* Developer Mode Routing Settings (if enabled) */}
        {s.developerMode && (
          <div style={{ marginBottom: "1.25rem" }}>
            <label>Routing</label>
            <div style={{ display: "flex", gap: "0.4rem", margin: "0.3rem 0 0.8rem" }}>
              <button className={`chip ${s.claudeMode === "relay" ? "active" : ""}`} onClick={() => updateSettings({ claudeMode: "relay" })}>Hosted</button>
              <button className={`chip ${s.claudeMode === "byo" ? "active" : ""}`} onClick={() => updateSettings({ claudeMode: "byo" })}>My own key</button>
            </div>
            {s.claudeMode === "relay" ? (
              <div className="list-grouped" style={{ border: "1px solid var(--line-2)" }}>
                <div className="form-col" style={{ padding: "0.5rem 0.8rem", borderBottom: "1px solid var(--line-2)" }}>
                  <label>Relay URL</label>
                  <input placeholder="https://..." value={s.relayUrl} onChange={(e) => updateSettings({ relayUrl: e.target.value })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} />
                </div>
                <div className="form-col" style={{ padding: "0.5rem 0.8rem" }}>
                  <label>Relay access code</label>
                  <input type="password" aria-label="Relay access code" value={s.relayCode ?? ""} onChange={(e) => updateSettings({ relayCode: e.target.value })} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none" }} />
                </div>
              </div>
            ) : (
              <div className="list-grouped" style={{ border: "1px solid var(--line-2)" }}>
                <div className="form-col" style={{ padding: "0.5rem 0.8rem" }}>
                  <label>API Key</label>
                  {keySet ? (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="badge badge-green" style={{ fontSize: "0.65rem" }}>key stored safely</span>
                      <button className="btn btn-ghost" style={{ padding: "0", fontSize: "0.75rem" }} onClick={removeKey}>Remove</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input type="password" aria-label="Anthropic API key" placeholder="sk-..." value={keyInput} onChange={(e) => setKeyInput(e.target.value)} style={{ border: "none", padding: 0, background: "transparent", boxShadow: "none", flex: 1 }} />
                      <button className="btn btn-primary" style={{ padding: "0.2rem 0.6rem", fontSize: "0.75rem" }} onClick={saveKey}>Save</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <label style={{ display: "block", marginTop: "0.5rem" }}>Analysis depth</label>
        {/* One source of truth: ANALYSIS_MODELS (claude/transport) also drives the relay
            contract test, so every model the picker offers is guaranteed accepted by the relay. */}
        <div className="list-grouped" style={{ marginTop: "0.4rem", border: "1px solid var(--line-2)" }}>
          {ANALYSIS_MODELS.map((m) => {
            const active = s.analysisModel === m.id;
            return (
              <div
                key={m.id}
                className="list-row"
                onClick={() => updateSettings({ analysisModel: m.id })}
                style={{
                  cursor: "pointer", justifyContent: "space-between",
                  background: active ? "var(--surface-2)" : "transparent",
                }}
              >
                <span>
                  <div style={{ fontWeight: 650, fontSize: "0.88rem", color: active ? "var(--primary)" : "var(--ink)" }}>{m.label}</div>
                  <div className="muted" style={{ fontSize: "0.72rem", marginTop: "0.05rem" }}>{m.hint}</div>
                </span>
                {active && <span style={{ color: "var(--primary)", fontWeight: 700 }}>✓</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 2. Region & currency — the home-market choice + the cross-currency FX rate ── */}
      <div className="card">
        <h3 style={H3}>Region &amp; currency</h3>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.8rem", maxWidth: 600 }}>
          Your home market — it sets the display currency, the tax buckets, the manual-entry
          options, and which market the AI analyst speaks to. Pick this once when you start; it
          isn't meant to be switched back and forth.
        </p>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {([
            { c: "India", label: "India · ₹" },
            { c: "US", label: "United States · $" },
          ] as const).map(({ c, label }) => {
            const active = s.country === c;
            return (
              <button
                key={c}
                className={`chip ${active ? "active" : ""}`}
                aria-pressed={active}
                onClick={() => {
                  if (active) return;
                  if (hasData) setPendingRegion(c);
                  else applyRegion(c);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {pendingRegion && (
          <div style={{ marginTop: "0.8rem", padding: "0.8rem 0.9rem", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "12px" }}>
            <p style={{ fontSize: "0.82rem", margin: "0 0 0.6rem", lineHeight: 1.6, maxWidth: 620 }}>
              Switch your home market to <strong>{pendingRegion === "US" ? "United States" : "India"}</strong>?
              Your accounts and values are <strong>safe and stay exactly as entered</strong> — Sampatti
              keeps everything in a neutral unit, so nothing is converted away or lost. What changes is the
              framing: amounts now show in <strong>{pendingRegion === "US" ? "$" : "₹"}</strong>, the tax
              buckets and manual-entry options switch to the {pendingRegion === "US" ? "US" : "Indian"}{" "}
              market, and the AI review speaks as a {pendingRegion === "US" ? "US" : "India"} analyst. A
              portfolio built for one market rarely reads well as the other, so only switch if you set
              this wrong to begin with.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => applyRegion(pendingRegion)}>
                Yes, switch to {pendingRegion === "US" ? "United States" : "India"}
              </button>
              <button className="btn btn-ghost" onClick={() => setPendingRegion(null)}>Cancel</button>
            </div>
          </div>
        )}

        {/* The ₹-per-$ pair that values any cross-currency holdings (always stored ₹ per $1). */}
        <div style={{ marginTop: "1rem", paddingTop: "0.8rem", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: "0.84rem", fontWeight: 600 }}>{profileFor(s).fxLabel}</div>
            <div className="muted" style={{ fontSize: "0.76rem", marginTop: "0.1rem" }}>
              Currently <strong>₹{s.usdInr}/$</strong> — refreshed automatically each launch.
            </div>
          </div>
          <button className="btn" disabled={fxBusy} onClick={() => void refreshRate()}>
            {fxBusy ? <span className="spinner" /> : "↻ Refresh rate"}
          </button>
        </div>
        {fxNote && <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>{fxNote}</p>}
      </div>

      {/* ── 4. Insights (optional Overview extras) ── */}
      <div className="card">
        <h3 style={H3}>Insights</h3>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.4rem", maxWidth: 600 }}>
          Optional extras for the Overview — off by default to keep things simple. Turn on what's useful to you.
        </p>
        {([
          { key: "healthScore", label: "Portfolio health score", hint: "A single 0–100 read across your exposure, concentration and liquidity." },
          { key: "goals", label: "Goals & retirement", hint: "Project your corpus to retirement and see whether you're on track." },
        ] as { key: "healthScore" | "goals"; label: string; hint: string }[]).map((f) => {
          const on = !!s.insights?.[f.key];
          return (
            <div key={f.key} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.65rem 0", borderTop: "1px solid var(--line-2)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{f.label}</div>
                <div className="muted" style={{ fontSize: "0.76rem" }}>{f.hint}</div>
              </div>
              <button className={`chip ${on ? "active" : ""}`} role="switch" aria-checked={on} aria-label={f.label}
                onClick={() => updateSettings({ insights: { ...s.insights, [f.key]: !on } })}>
                {on ? "On" : "Off"}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── 5. Privacy & data — the explainer (modal) + your-data controls ── */}
      <div className="card">
        <h3 style={H3}>Privacy &amp; data</h3>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.7rem", maxWidth: 600 }}>
          Everything stays on this device — no account, no cloud database.{" "}
          <button
            onClick={() => setShowPrivacy(true)}
            style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
          >
            How Sampatti handles your data
          </button>
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => void doExport()}>⬇ Export everything (JSON)</button>
          <button className="btn" onClick={() => backupRef.current?.click()}>⬆ Import a backup (.json)</button>
          <input ref={backupRef} type="file" hidden accept=".json,application/json"
            onChange={(e) => { void onPickBackup(e.target.files?.[0]); e.target.value = ""; }} />
          {confirmWipe ? (
            <>
              <button className="btn btn-danger" onClick={() => { void wipe(); setConfirmWipe(false); }}>Yes, erase all data</button>
              <button className="btn btn-ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-danger" onClick={() => setConfirmWipe(true)}>🗑 Erase all data</button>
          )}
        </div>
        {pendingImport && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.7rem" }}>
            <span style={{ fontSize: "0.82rem" }}>
              Replace your current portfolio with <strong>{pendingImport.name}</strong>? This overwrites
              what's on this device now (export first if you want to keep it).
            </span>
            <button className="btn btn-danger" onClick={() => runImport(pendingImport.text, pendingImport.name)}>Yes, replace</button>
            <button className="btn btn-ghost" onClick={() => setPendingImport(null)}>Cancel</button>
          </div>
        )}
        {exportNote && (
          <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.5rem" }}>{exportNote}</p>
        )}
        <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.5rem", maxWidth: 560 }}>
          Erasing removes your entire portfolio (accounts, holdings, income, edit history) and every
          local cache — nothing is left on this device, and Sampatti keeps no server copy. Your
          Anthropic key, if set, is a separate credential (managed under AI analysis above).
        </p>
      </div>

      {/* ── 6. Developer mode (the toggle that reveals the on-device engine below) ── */}
      <div className="card">
        <h3 style={H3}>Developer mode</h3>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.8rem", maxWidth: 600 }}>
          Unlocks experimental features — today, the <strong>on-device AI engine</strong> (shown below
          when on). Everyday use doesn't need it; everything else in Sampatti works without it.
        </p>
        {s.developerMode ? (
          <button
            className="btn btn-ghost"
            onClick={() => {
              // Leaving developer mode returns ALL routing to Claude so the visible state
              // matches behavior — re-enabling starts from the safe default again.
              updateSettings({ developerMode: false, ai: { extraction: "claude", analysis: "claude" } });
            }}
          >
            Turn off developer mode
          </button>
        ) : confirmDev ? (
          <div>
            <p style={{ fontSize: "0.82rem", maxWidth: 600, margin: "0 0 0.7rem", lineHeight: 1.55 }}>
              ⚠ <strong>A heads-up before you switch this on.</strong> Experimental features are newer
              and less tested than the rest of Sampatti — expect rough edges, slower results, and the
              occasional failure. They can't quietly corrupt anything: every import still lands in the
              review card for your approval. If something misbehaves, turn this off and the app goes
              back to exactly how it was.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => { updateSettings({ developerMode: true }); setConfirmDev(false); }}>
                I understand — turn it on
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmDev(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirmDev(true)}>Turn on developer mode…</button>
        )}
      </div>

      {/* ── 6. AI engines — revealed by developer mode: per-task Claude vs on-device ── */}
      {s.developerMode && (
        <div className="card">
          <h3 style={H3}>AI engines</h3>
          <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.8rem", maxWidth: 600 }}>
            Choose, per task, whether AI runs on <strong>Claude</strong> (best quality; the brief or
            the document you approve is sent) or <strong>on this device</strong> (nothing leaves —
            a smaller model, downloaded once). Mix freely.
          </p>
          {(["extraction", "analysis"] as const).map((task) => (
            <div key={task} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.4rem 0" }}>
              <span style={{ fontSize: "0.86rem", fontWeight: 600, width: 190 }}>
                {task === "extraction" ? "Statement extraction" : "Portfolio analysis & chat"}
              </span>
              <button className={`chip ${s.ai[task] === "claude" ? "active" : ""}`} onClick={() => setEngine(task, "claude")}>
                Claude — best quality
              </button>
              <button
                className={`chip ${s.ai[task] === "local" ? "active" : ""}`}
                disabled={model?.state !== "ready"}
                title={model?.state !== "ready" ? "Download the on-device model below first" : undefined}
                onClick={() => setEngine(task, "local")}
              >
                🔒 On this device{task === "analysis" ? " — quick take" : ""}
              </button>
            </div>
          ))}
          {isTauri() ? (
            <div style={{ marginTop: "0.7rem", paddingTop: "0.7rem", borderTop: "1px solid var(--line-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.84rem", fontWeight: 600 }}>On-device model</span>
                {model?.state === "ready" && <span className="badge badge-green">downloaded · {(model.size_bytes / 1e9).toFixed(2)} GB</span>}
                {model?.state === "partial" && <span className="badge badge-amber">partially downloaded — resume below</span>}
                {(!model || model.state === "absent") && <span className="badge badge-gray">not downloaded</span>}
                {dlProgress != null ? (
                  <span className="muted" style={{ fontSize: "0.8rem" }}>downloading… {(dlProgress * 100).toFixed(0)}%</span>
                ) : model?.state === "ready" ? (
                  <button className="btn btn-ghost" onClick={() => void removeModel()}>Remove model</button>
                ) : (
                  <button className="btn" onClick={() => void downloadModel()}>
                    ⬇ Download model (~2.3 GB, one time)
                  </button>
                )}
              </div>
              <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.4rem", maxWidth: 600 }}>
                Qwen3-4B (Apache-2.0), fetched once from huggingface.co and integrity-verified
                (sha-256). It runs entirely inside Sampatti — no separate app, no server. Screenshots
                and scans still use Claude even in on-device mode (small models can't read them well).
              </p>
              {modelErr && <div className="badge badge-rose" style={{ marginTop: "0.4rem", padding: "0.3rem 0.6rem" }}>{modelErr}</div>}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.5rem" }}>
              The on-device model is available in the desktop app (this is the web preview).
            </p>
          )}
        </div>
      )}

      {showPrivacy && (
        <div className="modal-backdrop" onClick={() => setShowPrivacy(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="How Sampatti handles your data" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "-0.5rem" }}>
              <button className="btn btn-ghost" aria-label="Close" onClick={() => setShowPrivacy(false)}>✕</button>
            </div>
            <PrivacyExplainer />
          </div>
        </div>
      )}

      {/* About footer: version + standard educational disclaimer + copyright. */}
      <div className="muted" style={{ textAlign: "center", fontSize: "0.74rem", lineHeight: 1.65, padding: "0.6rem 0 0.2rem", borderTop: "1px solid var(--line-2)" }}>
        <div><strong>Sampatti</strong> v{__APP_VERSION__}</div>
        {isTauri() && (
          <div style={{ marginTop: "0.3rem" }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: "0.72rem", padding: "0.15rem 0.55rem" }}
              disabled={updating}
              onClick={runUpdateCheck}
            >
              {updating ? "Working…" : "Check for updates"}
            </button>
            {updateMsg && <div style={{ marginTop: "0.25rem" }}>{updateMsg}</div>}
          </div>
        )}
        <div>For educational and personal use only — not investment advice, and not a substitute for a registered financial adviser.</div>
        <div>© {new Date().getFullYear()} Sampatti · your data stays on your device.</div>
      </div>
    </div>
  );
}
