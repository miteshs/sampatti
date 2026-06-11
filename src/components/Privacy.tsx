import { useEffect, useState, type ReactNode } from "react";
import { useStore, exportPortfolio } from "../storage/store";
import { DEFAULT_RELAY_URL } from "../domain/types";
import { clearByoKey, diskEncryption, hasByoKey, keyStoreName, setByoKey, storageLocation, isTauri } from "../platform";
import { ANALYSIS_MODELS } from "../claude/transport";
import { fetchUsdInr } from "../domain/fx";

export function Privacy() {
  const { portfolio, updateSettings, wipe } = useStore();
  const s = portfolio.settings;
  const [location, setLocation] = useState("…");
  const [keyInput, setKeyInput] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [fxBusy, setFxBusy] = useState(false);
  const [fxNote, setFxNote] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const doExport = async () => {
    try {
      const dest = await exportPortfolio(portfolio);
      if (dest) setExportNote(`Saved to ${dest}`);
    } catch (e) {
      setExportNote(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

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
    void storageLocation().then(setLocation);
    void hasByoKey().then(setKeySet);
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
      <div className="card card-pad-lg">
        <div className="eyebrow">Transparency</div>
        <h2 style={{ fontSize: "1.3rem", margin: "0.2rem 0 1rem" }}>Where your data lives, and what leaves</h2>
        <Flow icon="💾" title="Stored only on this device"
          body={<>Your accounts, holdings and income are saved to <code>{location}</code>. There is no
            account and no cloud database — nothing is uploaded for storage.</>} />
        <Flow icon="📤" title="What leaves the device — and only this"
          body={<>For analysis, a compact <strong>portfolio brief</strong> — totals, percentages, and your
            top holdings’ names + account labels, <strong>not your raw files</strong> — plus your chat
            questions are sent to Claude. (On the AI Analysis screen you can preview the exact JSON before
            anything is sent.) For PDFs and screenshots, the <strong>document you choose</strong> is sent to
            Claude to extract holdings — always after you confirm. CSV and Excel files are parsed here and
            never sent — unless a file's layout can't be read and you explicitly choose “Parse with Claude”.</>} />
        <Flow icon="🛡️" title="What we never see"
          body={<>In relay mode the brief passes through the relay to Anthropic and is <strong>not
            stored or logged</strong>. In your-own-key mode it goes straight from your device to
            Anthropic and never touches our servers. Anthropic does not train on API data.</>} />
        <Flow icon="🔐" title="At rest"
          body={isTauri()
            ? <>Turn on {diskEncryption().os} <strong>{diskEncryption().tool}</strong> ({diskEncryption().where}) to
              encrypt the whole disk, including this app's data file.</>
            : <>You're viewing the web preview, so data sits in this browser's local storage. The
              desktop app stores it as a file on your computer instead.</>} />
      </div>

      <div className="card">
        <h3 style={{ fontSize: "1.05rem", marginBottom: "0.8rem" }}>How analysis reaches Claude</h3>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
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
            <input placeholder="https://your-relay.workers.dev" value={s.relayUrl} onChange={(e) => updateSettings({ relayUrl: e.target.value })} />
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
                <input type="password" placeholder="sk-ant-…" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
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
      </div>

      <div className="card">
        <h3 style={{ fontSize: "1.05rem", marginBottom: "0.8rem" }}>Settings</h3>

        <label>Analysis model</label>
        <p className="muted" style={{ fontSize: "0.76rem", margin: "0 0 0.6rem" }}>
          Which Claude writes your analysis. Output length drives cost, so a lighter model is the
          simplest way to cut spend. Costs are rough, per analysis, on your own key.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1.25rem" }}>
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
                  background: active ? "var(--primary-soft)" : "var(--surface, #fff)",
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

        <div style={{ maxWidth: 320 }}>
          <label>USD → INR rate (for US holdings)</label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="number" style={{ maxWidth: 130 }} value={s.usdInr}
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

      <div className="card">
        <h3 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Your data, your control</h3>
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
          Erases your entire portfolio (accounts, holdings, income, edit history) and every local cache,
          including the net-worth price history — nothing is left on this device. Sampatti keeps no server
          database, so there's nothing stored elsewhere to remove. Your Anthropic API key, if you set one,
          is a separate credential — remove it with the key control above.
        </p>
      </div>
    </div>
  );
}

function Flow({ icon, title, body }: { icon: string; title: string; body: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "0.9rem", padding: "0.7rem 0", borderTop: "1px solid var(--line-2)" }}>
      <span style={{ fontSize: "1.3rem" }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{title}</div>
        <div className="muted" style={{ fontSize: "0.88rem", lineHeight: 1.6, marginTop: "0.15rem" }}>{body}</div>
      </div>
    </div>
  );
}
