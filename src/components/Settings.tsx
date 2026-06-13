// Configuration lives here (⚙), organised by what the user is actually deciding:
//   1. AI analysis   — how the review reaches Claude (relay / own key) + which model writes it
//   2. Region & currency
//   3. Appearance     — light / dark
//   4. Insights       — optional Overview extras
//   5. Developer mode — experimental toggle… which reveals
//   6. AI engines     — the on-device engine (only when developer mode is on)
// The Privacy tab stays a pure explainer + data controls — the two are deliberately not mixed.
import { useEffect, useState } from "react";
import { useStore, exportPortfolio } from "../storage/store";
import { DEFAULT_RELAY_URL } from "../domain/types";
import { clearByoKey, hasByoKey, keyStoreName, setByoKey, isTauri } from "../platform";
import { ANALYSIS_MODELS } from "../claude/transport";
import { localModelDownload, localModelRemove, localModelStatus, type LocalModelStatus } from "../ai/engine";
import type { AiEngine } from "../domain/types";
import { fetchUsdInr } from "../domain/fx";
import { profileFor } from "../regions/profile";
import { PrivacyExplainer } from "./Privacy";

const H3 = { fontSize: "1.05rem", marginBottom: "0.3rem" } as const;

export function Settings() {
  const { portfolio, updateSettings, wipe } = useStore();
  const s = portfolio.settings;
  const [keyInput, setKeyInput] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [confirmDev, setConfirmDev] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  const doExport = async () => {
    try {
      const dest = await exportPortfolio(portfolio);
      if (dest) setExportNote(`Saved to ${dest}`);
    } catch (e) {
      setExportNote(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
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
    <div className="grid" style={{ gap: "1.25rem", maxWidth: 760 }}>
      {/* ── 1. AI analysis: how the review reaches Claude, and which model writes it ── */}
      <div className="card">
        <h3 style={H3}>AI analysis</h3>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.9rem", maxWidth: 600 }}>
          Where the review runs and which model writes it. Your portfolio stays on device — only the
          compact brief (or a document you approve) is sent.
        </p>

        {/* The relay-vs-own-key choice is hidden for now (alpha): the app just uses the relay.
            Revealed under Developer mode so it stays recoverable for advanced users / testing. */}
        {s.developerMode ? (
        <>
        <label>How analysis reaches Claude</label>
        <div style={{ display: "flex", gap: "0.5rem", margin: "0.3rem 0 1rem" }}>
          <button className={`chip ${s.claudeMode === "relay" ? "active" : ""}`} onClick={() => updateSettings({ claudeMode: "relay" })}>
            Relay (default, easiest)
          </button>
          <button className={`chip ${s.claudeMode === "byo" ? "active" : ""}`} onClick={() => updateSettings({ claudeMode: "byo" })}>
            My own Anthropic key (max privacy)
          </button>
        </div>

        {s.claudeMode === "relay" ? (
          <div>
            <label>Relay URL</label>
            <input aria-label="Relay URL" placeholder="https://your-relay.workers.dev" value={s.relayUrl} onChange={(e) => updateSettings({ relayUrl: e.target.value })} />
            <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>
              The relay holds the Anthropic key server-side and forwards your brief without storing it.
              {!s.relayUrl && <> <strong>No relay is set yet</strong> — deploy <code>relay/</code> (see its
                README) and paste the URL here, or switch to <em>your own key</em> for the most private setup.</>}
            </p>
            {s.relayUrl && s.relayUrl !== DEFAULT_RELAY_URL && (
              <p style={{ fontSize: "0.76rem", marginTop: "0.3rem", color: "var(--warn, #9a6a00)" }}>
                ⚠ <strong>Custom relay</strong> — your portfolio brief and questions will be sent to this
                address. Only use a relay you run or fully trust; https is required.
              </p>
            )}
            <label style={{ display: "block", marginTop: "0.9rem" }}>
              Relay access code <span className="muted" style={{ fontWeight: 400 }}>— optional</span>
            </label>
            <input
              type="password"
              aria-label="Relay access code"
              placeholder="paste a code someone shared with you"
              value={s.relayCode ?? ""}
              onChange={(e) => updateSettings({ relayCode: e.target.value })}
            />
            <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>
              Only needed if the relay above requires a code. If a friend shared their relay with you,
              paste the code they gave you here; otherwise leave it blank.
            </p>
          </div>
        ) : (
          <div>
            <label>Anthropic API key</label>
            {keySet ? (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="badge badge-green">key set · {isTauri() ? `stored in ${keyStoreName()}` : "kept in this tab only"}</span>
                <button className="btn btn-ghost" onClick={removeKey}>Remove</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input type="password" aria-label="Anthropic API key" placeholder="sk-ant-…" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
                <button className="btn btn-primary" onClick={saveKey}>Save key</button>
              </div>
            )}
            <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>
              {isTauri()
                ? `Stored in the ${keyStoreName()} and used from the app's native layer — it never enters the web view.`
                : "In the web preview the key is kept in this tab's memory only (cleared when you close it); the desktop app uses the system keychain."}
            </p>
          </div>
        )}
        </>
        ) : (
          <>
            <label>Access code <span className="muted" style={{ fontWeight: 400 }}>— from the developer</span></label>
            <input
              type="password"
              aria-label="Relay access code"
              placeholder="paste the code you were given"
              value={s.relayCode ?? ""}
              onChange={(e) => updateSettings({ relayCode: e.target.value })}
            />
            <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem", maxWidth: 600 }}>
              Your analysis runs through Sampatti's relay, which is invite-only during alpha — paste
              the access code you were given. (Prefer your own Anthropic key? Enable developer mode below.)
            </p>
          </>
        )}

        <label style={{ display: "block", marginTop: "1.3rem" }}>Analysis model</label>
        <p className="muted" style={{ fontSize: "0.76rem", margin: "0 0 0.6rem" }}>
          Which Claude writes your analysis. More thorough models reason deeper on nuance;
          lighter ones reply faster.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {ANALYSIS_MODELS.map((m) => {
            const active = s.analysisModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => updateSettings({ analysisModel: m.id })}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem",
                  textAlign: "left", padding: "0.6rem 0.8rem", borderRadius: 10, cursor: "pointer",
                  border: active ? "1.5px solid var(--primary)" : "1px solid var(--line-2)",
                  background: active ? "var(--primary-soft)" : "var(--card)",
                }}
              >
                <span>
                  <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{m.label}</span>
                  <span className="muted" style={{ display: "block", fontSize: "0.74rem", marginTop: "0.1rem" }}>{m.hint}</span>
                </span>
                {active && <span style={{ color: "var(--primary)", fontWeight: 700 }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 2. Region & currency ── */}
      <div className="card">
        <h3 style={H3}>Region &amp; currency</h3>
        <p className="muted" style={{ fontSize: "0.76rem", margin: "0 0 0.6rem", maxWidth: 600 }}>
          Tax language, the analyst persona, examples and currency display follow your market.
          Your data itself is never changed or converted in storage — figures display at the
          ₹/$ rate below.
        </p>
        <label>Region</label>
        <div style={{ display: "flex", gap: "0.5rem", margin: "0.3rem 0 1.25rem" }}>
          <button className={`chip ${s.country !== "US" ? "active" : ""}`} onClick={() => updateSettings({ country: "India", baseCurrency: "INR" })}>
            India
          </button>
          <button className={`chip ${s.country === "US" ? "active" : ""}`} onClick={() => updateSettings({ country: "US", baseCurrency: "USD" })}>
            United States
          </button>
        </div>

        <div style={{ maxWidth: 320 }}>
          <label>{profileFor(s).fxLabel}</label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="number" aria-label="Exchange rate, rupees per dollar" style={{ maxWidth: 130 }} value={s.usdInr}
              onChange={(e) => updateSettings({ usdInr: Number(e.target.value) || s.usdInr })} />
            <button className="btn btn-ghost" onClick={refreshRate} disabled={fxBusy}>
              {fxBusy ? <span className="spinner" /> : "↻ Fetch live"}
            </button>
          </div>
          <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.35rem" }}>
            {fxNote ?? "Refreshed automatically each time the app opens; fetch anytime — only the public rate is requested, no data about you is sent."}
          </p>
        </div>
      </div>

      {/* ── 3. Appearance ── */}
      <div className="card">
        <h3 style={H3}>Appearance</h3>
        <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.6rem", maxWidth: 600 }}>
          Light by default. Dark mode is opt-in — it won't follow your device's setting unless you choose it here.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className={`chip ${(s.theme ?? "light") !== "dark" ? "active" : ""}`}
            aria-pressed={(s.theme ?? "light") !== "dark"} onClick={() => updateSettings({ theme: "light" })}>
            ☀ Light
          </button>
          <button className={`chip ${s.theme === "dark" ? "active" : ""}`}
            aria-pressed={s.theme === "dark"} onClick={() => updateSettings({ theme: "dark" })}>
            ☾ Dark
          </button>
        </div>
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
          {confirmWipe ? (
            <>
              <button className="btn btn-danger" onClick={() => { void wipe(); setConfirmWipe(false); }}>Yes, erase all data</button>
              <button className="btn btn-ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-danger" onClick={() => setConfirmWipe(true)}>🗑 Erase all data</button>
          )}
        </div>
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
            <button className="btn btn-ghost" aria-label="Close" onClick={() => setShowPrivacy(false)}
              style={{ position: "absolute", top: "0.5rem", right: "0.5rem" }}>✕</button>
            <PrivacyExplainer />
          </div>
        </div>
      )}
    </div>
  );
}
