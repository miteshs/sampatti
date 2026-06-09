import { useEffect, useState, type ReactNode } from "react";
import { useStore, exportPortfolio } from "../storage/store";
import { clearByoKey, hasByoKey, setByoKey, storageLocation, isTauri } from "../platform";

export function Privacy() {
  const { portfolio, updateSettings, wipe } = useStore();
  const s = portfolio.settings;
  const [location, setLocation] = useState("…");
  const [keyInput, setKeyInput] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

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
          body={<>For analysis, a compact <strong>portfolio brief</strong> (totals and percentages,
            not your raw files) and your chat questions are sent to Claude. For PDFs and screenshots,
            the <strong>document you choose</strong> is sent to Claude to extract holdings — always
            after you confirm. CSV and Excel files are parsed here and never sent.</>} />
        <Flow icon="🛡️" title="What we never see"
          body={<>In relay mode the brief passes through the relay to Anthropic and is <strong>not
            stored or logged</strong>. In your-own-key mode it goes straight from your device to
            Anthropic and never touches our servers. Anthropic does not train on API data.</>} />
        <Flow icon="🔐" title="At rest"
          body={isTauri()
            ? <>Turn on macOS <strong>FileVault</strong> (System Settings → Privacy &amp; Security) to
              encrypt the whole disk, including this app's data file.</>
            : <>You're viewing the web preview, so data sits in this browser's local storage. The
              desktop app stores it as a file on your Mac instead.</>} />
      </div>

      <div className="card">
        <h3 style={{ fontSize: "1.05rem", marginBottom: "0.8rem" }}>How analysis reaches Claude</h3>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button className={`chip ${s.claudeMode === "relay" ? "active" : ""}`} onClick={() => updateSettings({ claudeMode: "relay" })}>
            Relay (default, easiest)
          </button>
          <button className={`chip ${s.claudeMode === "byo" ? "active" : ""}`} onClick={() => keySet && updateSettings({ claudeMode: "byo" })}>
            My own Anthropic key (max privacy)
          </button>
        </div>

        {s.claudeMode === "relay" ? (
          <div>
            <label>Relay URL</label>
            <input value={s.relayUrl} onChange={(e) => updateSettings({ relayUrl: e.target.value })} />
            <p className="muted" style={{ fontSize: "0.76rem", marginTop: "0.4rem" }}>
              The relay holds the Anthropic key server-side and forwards your brief without storing it.
            </p>
          </div>
        ) : (
          <div>
            <label>Anthropic API key</label>
            {keySet ? (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span className="badge badge-green">key set · {isTauri() ? "stored in macOS Keychain" : "kept in this tab only"}</span>
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
                ? "Stored in the macOS Keychain and used from the app's native layer — it never enters the web view."
                : "In the web preview the key is kept in this tab's memory only (cleared when you close it); the desktop app uses the system Keychain."}
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ fontSize: "1.05rem", marginBottom: "0.8rem" }}>Settings</h3>
        <div style={{ maxWidth: 220 }}>
          <label>USD → INR rate (for US holdings)</label>
          <input type="number" value={s.usdInr} onChange={(e) => updateSettings({ usdInr: Number(e.target.value) || s.usdInr })} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Your data, your control</h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => exportPortfolio(portfolio)}>⬇ Export everything (JSON)</button>
          {confirmWipe ? (
            <>
              <button className="btn btn-danger" onClick={() => { void wipe(); setConfirmWipe(false); }}>Yes, erase all data</button>
              <button className="btn btn-ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-danger" onClick={() => setConfirmWipe(true)}>🗑 Erase all data</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Flow({ icon, title, body }: { icon: string; title: string; body: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "0.9rem", padding: "0.7rem 0", borderTop: "1px solid var(--line-2)" }}>
      <span style={{ fontSize: "1.3rem" }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{title}</div>
        <div className="muted" style={{ fontSize: "0.84rem", lineHeight: 1.55, marginTop: "0.15rem" }}>{body}</div>
      </div>
    </div>
  );
}
