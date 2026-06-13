// The privacy EXPLAINER + your-data controls, and nothing else: where data lives, what
// leaves the device, export and erase. All configuration (models, region, keys, engines)
// lives on the Settings tab (⚙) — the user asked for the two not to be mixed.
import { useEffect, useState, type ReactNode } from "react";
import { useStore, exportPortfolio } from "../storage/store";
import { diskEncryption, storageLocation, isTauri, isIOS } from "../platform";
import { profileFor } from "../regions/profile";

export function Privacy() {
  const { portfolio, wipe } = useStore();
  const s = portfolio.settings;
  const [location, setLocation] = useState("…");
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const doExport = async () => {
    try {
      const dest = await exportPortfolio(portfolio);
      if (dest) setExportNote(`Saved to ${dest}`);
    } catch (e) {
      setExportNote(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    void storageLocation().then(setLocation);
  }, []);

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
            Claude to extract holdings — always after you confirm. CSV and Excel files{profileFor(s).region === "US" ? "" : <> — and your{" "}
            <strong>CAS</strong> (CAMS/KFintech and NSDL/CDSL), password and all —</>} are parsed here and never sent, unless a
            file's layout can't be read and you explicitly choose “Parse with Claude”.</>} />
        <Flow icon="🛡️" title="What we never see"
          body={<>In relay mode the brief passes through the relay to Anthropic and is <strong>not
            stored or logged</strong>. In your-own-key mode it goes straight from your device to
            Anthropic and never touches our servers. Anthropic does not train on API data.
            How analysis reaches Claude is yours to choose on the <strong>Settings tab (⚙)</strong>.</>} />
        <Flow icon="🔐" title="At rest"
          body={!isTauri()
            ? <>You're viewing the web preview, so data sits in this browser's local storage. The
              desktop app stores it as a file on your computer instead.</>
            : isIOS()
              ? <>On {diskEncryption().os}, <strong>{diskEncryption().tool}</strong> already encrypts this
                app's data — {diskEncryption().where}. Your data is also <strong>kept out of iCloud and
                device backups</strong>, so it never leaves the device; use <strong>Export</strong> below to
                make your own backup.</>
              : <>Turn on {diskEncryption().os} <strong>{diskEncryption().tool}</strong> ({diskEncryption().where}) to
                encrypt the whole disk, including this app's data file.</>} />
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
          is a separate credential — remove it on the Settings tab (⚙).
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
