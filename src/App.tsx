import { currentProfile } from "./regions/profile";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./storage/store";
import { fetchUsdInr } from "./domain/fx";
import { Overview } from "./components/Overview";
import { Performance } from "./components/Performance";
import { Manage } from "./components/Manage";
import { AnalysisChat } from "./components/AnalysisChat";
import { AddData } from "./components/AddData";
import { Privacy } from "./components/Privacy";
import { Settings } from "./components/Settings";
import { ErrorBoundary } from "./components/ErrorBoundary";

type View = "overview" | "performance" | "manage" | "analysis" | "add" | "privacy" | "settings";

const NAV: { key: View; label: string; aria?: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "performance", label: "Performance" },
  { key: "manage", label: "Manage" },
  { key: "analysis", label: "AI Analysis" },
  { key: "add", label: "Add data" },
  { key: "privacy", label: "Privacy" },
  { key: "settings", label: "Settings" },
];

export default function App() {
  const load = useStore((s) => s.load);
  const loaded = useStore((s) => s.loaded);
  const hasData = useStore((s) => s.portfolio.holdings.length > 0);
  const [view, setView] = useState<View>("overview");

  useEffect(() => { void load(); }, [load]);

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

  // First run with no data → start on Add data so the demo button is front and center.
  useEffect(() => {
    if (loaded && !hasData) setView("add");
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={view === n.key ? "active" : ""} aria-label={n.aria ?? n.label}
              title={n.aria} onClick={() => setView(n.key)}>
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
            {view === "manage" && <Manage />}
            {view === "analysis" && (hasData
              ? <AnalysisChat onConfigure={() => setView("settings")} />
              : <Empty onAdd={() => setView("add")} />)}
            {view === "add" && <AddData onConfigure={() => setView("settings")} />}
            {view === "privacy" && <Privacy />}
            {view === "settings" && <Settings />}
          </ErrorBoundary>
        </main>
      )}
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
      <button className="btn btn-primary" onClick={onAdd}>Go to Add data</button>
    </div>
  );
}
