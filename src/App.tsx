import { currentProfile } from "./regions/profile";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./storage/store";
import { fetchUsdInr } from "./domain/fx";
import { Overview } from "./components/Overview";
import { Performance } from "./components/Performance";
import { AnalysisChat } from "./components/AnalysisChat";
import { Holdings } from "./components/Holdings";
import { Settings } from "./components/Settings";
import { ErrorBoundary } from "./components/ErrorBoundary";

type View = "overview" | "performance" | "holdings" | "analysis" | "settings";

type NavItem = { key: View; label: string; short?: string; aria?: string };

// Five destinations — they all fit a phone's bottom tab bar (≤5, iOS HIG), so there's no
// "More" sheet. One source of truth feeds both the desktop pill nav and the mobile bar.
const NAV: NavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "performance", label: "Performance", short: "Perf." },
  { key: "holdings", label: "Holdings" },
  { key: "analysis", label: "AI Analysis", short: "AI" },
  { key: "settings", label: "Settings", short: "⚙" },
];

export default function App() {
  const load = useStore((s) => s.load);
  const loaded = useStore((s) => s.loaded);
  const hasData = useStore((s) => s.portfolio.holdings.length > 0);
  const [view, setView] = useState<View>("overview");

  useEffect(() => { void load(); }, [load]);

  // Opt-in dark mode: reflect the saved theme onto <html data-theme>. Default/absent ⇒ light,
  // so the app only goes dark when the user chooses it (never from the OS preference).
  const theme = useStore((s) => s.portfolio.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
  }, [theme]);

  // Refresh the USD→INR rate once per launch so US holdings are never valued on a stale
  // rate. Silent and best-effort: offline → keep the stored rate; only a public exchange
  // rate is requested, nothing about the user is sent.
  const fxFetched = useRef(false);
  useEffect(() => {
    if (!loaded || fxFetched.current) return;
    fxFetched.current = true;
    void fetchUsdInr().then((rate) => {
      if (rate && rate !== useStore.getState().portfolio.settings.usdInr) {
        useStore.getState().updateSettings({ usdInr: rate });
      }
    });
  }, [loaded]);

  // First run with no data → start on Holdings; its welcome state has the demo + import.
  useEffect(() => {
    if (loaded && !hasData) setView("holdings");
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (v: View) => setView(v);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">सं</div>
          <div>
            <div className="name">Sampatti</div>
            <div className="tag">Private portfolio analysis · {currentProfile().label}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <button key={n.key} className={view === n.key ? "active" : ""} aria-label={n.aria ?? n.label}
              title={n.aria} onClick={() => go(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
      </div>

      {!loaded ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <span className="spinner" />
        </div>
      ) : (
        <main className="view" key={view}>
          <ErrorBoundary>
            {view === "overview" && <Overview />}
            {view === "performance" && <Performance />}
            {view === "holdings" && <Holdings onConfigure={() => go("settings")} />}
            {view === "analysis" && (hasData
              ? <AnalysisChat onConfigure={() => go("settings")} />
              : <Empty onAdd={() => go("holdings")} />)}
            {view === "settings" && <Settings />}
          </ErrorBoundary>
        </main>
      )}

      {/* ---- mobile bottom tab bar (CSS shows it only under the breakpoint) ---- */}
      <nav className="tabbar" aria-label="Primary">
        {NAV.map((n) => (
          <button key={n.key} className={view === n.key ? "active" : ""} aria-current={view === n.key ? "page" : undefined}
            aria-label={n.aria ?? n.label} onClick={() => go(n.key)}>
            <NavIcon name={n.key} />
            <span>{n.short ?? n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="card card-pad-lg" style={{ textAlign: "center", padding: "3rem" }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>Add a portfolio first</div>
      <p className="muted" style={{ margin: "0.5rem auto 1rem", maxWidth: 380 }}>
        Import a statement, enter accounts by hand, or load the demo to see the AI analysis in action.
      </p>
      <button className="btn btn-primary" onClick={onAdd}>Go to Holdings</button>
    </div>
  );
}

// Compact line icons for the bottom nav. Stroke width comes from CSS so the active tab can
// thicken its glyph.
function NavIcon({ name }: { name: View }) {
  const base = {
    width: 24, height: 24, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "overview":
      return (<svg {...base}><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /></svg>);
    case "performance":
      return (<svg {...base}><path d="M3 17l5.5-5.5 3.5 3L21 6" /><path d="M15.5 6H21v5.5" /></svg>);
    case "holdings":
      return (<svg {...base}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.5" fill="currentColor" stroke="none" /></svg>);
    case "analysis":
      return (<svg {...base}><path d="M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9L12 16.8l-1.9-4.9L5.2 10l4.9-1.9z" /><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>);
    case "settings":
      return (<svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 13a7.8 7.8 0 000-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-1.7-1L15 2.6h-4l-.3 2.4a7.6 7.6 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7.8 7.8 0 000 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 001.7 1l.3 2.4h4l.3-2.4a7.6 7.6 0 001.7-1l2.4 1 2-3.4z" /></svg>);
  }
}
