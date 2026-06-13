// The transparency EXPLAINER — where data lives, what leaves the device, at rest. Rendered
// inside the "How Sampatti handles your data" modal on the Settings tab (⚙); the data
// controls (export / erase) live in that same Settings section.
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../storage/store";
import { diskEncryption, storageLocation, isTauri, isIOS } from "../platform";
import { profileFor } from "../regions/profile";

export function PrivacyExplainer() {
  const s = useStore((st) => st.portfolio.settings);
  const [location, setLocation] = useState("…");

  useEffect(() => {
    void storageLocation().then(setLocation);
  }, []);

  return (
      <div className="card card-pad-lg" style={{ boxShadow: "none", border: "none", padding: 0 }}>
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
