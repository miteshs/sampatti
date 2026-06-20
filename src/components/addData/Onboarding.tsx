// First-run onboarding: the Welcome card (the single first ask — try the sample or import) and the
// collapsible step-by-step guide. Plain words on purpose — the audience may have never used
// anything beyond WhatsApp and net banking.
import { useState, type ReactNode } from "react";
import { useStore } from "../../storage/store";
import { keyStoreName } from "../../platform";
import { currentProfile } from "../../regions/profile";

// The first thing a brand-new user sees. The audience has no finance/computer vocabulary,
// so this screen makes exactly ONE ask — try the sample, or bring your own files — and
// keeps the step-by-step under a collapsed "How it works".
export function Welcome({ onDemo, onImport }: { onDemo: () => void; onImport: () => void }) {
  const [confirmDemo, setConfirmDemo] = useState(false);
  const hasData = useStore((s) => s.portfolio.holdings.length > 0 || s.portfolio.accounts.length > 0);

  const onDemoClick = () => {
    if (hasData) setConfirmDemo(true);
    else onDemo();
  };

  // Subscribing to country makes the copy below swap live when a chip is clicked.
  const country = useStore((s) => s.portfolio.settings.country);
  const updateSettings = useStore((s) => s.updateSettings);
  const chooseRegion = (c: "India" | "US") =>
    updateSettings({ country: c, baseCurrency: c === "US" ? "USD" : "INR" });
  return (
    <div className="card card-pad-lg" style={{ textAlign: "center", padding: "2.6rem 1.5rem" }}>
      <div className="eyebrow">Welcome</div>
      <h1 style={{ fontSize: "1.9rem", margin: "0.35rem 0 0.5rem" }}>All your money, in one private picture</h1>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", alignItems: "center", flexWrap: "wrap", margin: "0.2rem 0 0.9rem" }}>
        <span className="muted" style={{ fontSize: "0.85rem" }}>Where do you manage your money?</span>
        <button className={`chip ${country !== "US" ? "active" : ""}`} onClick={() => chooseRegion("India")}>India</button>
        <button className={`chip ${country === "US" ? "active" : ""}`} onClick={() => chooseRegion("US")}>United States</button>
      </div>
      <p className="muted" style={{ maxWidth: 520, margin: "0 auto 1.5rem", fontSize: "0.95rem", lineHeight: 1.6 }}>
        {currentProfile().region === "US"
          ? "Stocks, funds, 401(k)s, property — added up, explained in plain words, and reviewed by AI when you ask."
          : "Stocks, mutual funds, PF, FDs, property, gold — added up, explained in plain words, and reviewed by AI when you ask."}{" "}
        Everything stays on this computer; nothing is uploaded.
      </p>
      <div style={{ display: "flex", gap: "0.7rem", justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
        {confirmDemo ? (
          <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center", background: "var(--surface-2)", padding: "0.6rem 1rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
            <span className="muted" style={{ fontSize: "0.85rem" }}>Overwrite existing data?</span>
            <button className="btn btn-danger" onClick={onDemo}>Yes, replace</button>
            <button className="btn btn-ghost" onClick={() => setConfirmDemo(false)}>Cancel</button>
          </span>
        ) : (
          <button className="btn btn-primary" style={{ fontSize: "0.95rem", padding: "0.7rem 1.4rem" }} onClick={onDemoClick}>
            ▶ Try the sample portfolio
          </button>
        )}
        <button className="btn" style={{ fontSize: "0.95rem", padding: "0.7rem 1.4rem" }} onClick={onImport}>
          📁 Add my own statements
        </button>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.9rem" }}>
        {country === "US"
          ? "The demo is a made-up $2.3M portfolio with 18 months of history — play freely, then clear it with one click."
          : "The demo is a made-up ₹14 Cr portfolio with 18 months of history — play freely, then clear it with one click."}
      </p>
    </div>
  );
}

// The full guide also lives at github.com/miteshs/sampatti-releases (and docs/getting-started.md);
// this is the in-app version, self-contained because the webview doesn't open external links.
// Collapsed by default — the Welcome card above carries the first ask.
export function GettingStarted({ expanded = false }: { expanded?: boolean }) {
  const [open, setOpen] = useState(false);
  const Step = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
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
  const steps = (
    <div className="grid" style={{ gap: "0.65rem", marginTop: expanded ? 0 : "0.9rem" }}>
        <Step n={1} title="Collect a statement from each place your money lives.">
          {currentProfile().region === "US" ? (
            <><strong>Fastest start:</strong> download the positions CSV from each brokerage
            (Schwab, Fidelity, Vanguard…) — read entirely on this computer. PDFs and screenshots
            work too. Put them all in one folder.</>
          ) : (
            <><strong>Fastest start:</strong> your monthly <strong>NSDL/CDSL CAS email</strong> has every demat stock AND fund; for purchase costs request the detailed CAS at camsonline.com (Statements → CAS). Both are read entirely on this computer.
            For everything else, download the holdings statement — Excel or CSV is best (also read
            on this computer), and PDFs or screenshots work too. Put them all in one folder.</>
          )}
        </Step>
        <Step n={2} title="Import that folder here.">
          Every statement becomes a card for you to check — the account name, the amounts,
          anything that looks off. Nothing is saved until you approve each card. Import a newer
          statement next month and it updates that account instead of duplicating it.
        </Step>
        <Step n={3} title="Add the rest by hand.">
          {currentProfile().region === "US"
            ? "Your house, 401(k)/IRA balances, CDs, insurance — and any loans, so the total is honest."
            : "Your house, PF, FDs, insurance, gold — and any loans, so the total is honest."}{" "}
          There's a simple form below; everything can be edited later, right here on Holdings.
        </Step>
        <Step n={4} title="Bring values up to today.">
          Use “Refresh live prices” here on Holdings. The app also quietly records your net worth every day
          you open it, so a personal history chart builds itself.
        </Step>
        <Step n={5} title="Connect Claude for the AI review (Settings tab).">
          During alpha, paste the access code you were given (Settings → AI analysis), or use your
          own Anthropic key under developer mode — stored in the {keyStoreName()} on this computer.
        </Step>
        <Step n={6} title="Ask anything, in your own words.">
          Run the analysis, then ask questions like “am I too dependent on one stock?” —
          only a small summary of totals and percentages is ever sent, never your statements.
          You can preview exactly what goes before anything is sent.
        </Step>
      </div>
  );
  if (expanded) return steps;
  return (
    <details className="card" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span className="eyebrow" style={{ flex: 1 }}>📖 How it works, step by step</span>
        <span className="muted" style={{ fontSize: "0.78rem" }}>{open ? "hide" : "show"}</span>
      </summary>
      {steps}
    </details>
  );
}
