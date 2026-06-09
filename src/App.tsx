import { useEffect, useState } from "react";
import { useStore } from "./storage/store";
import { Overview } from "./components/Overview";
import { AnalysisChat } from "./components/AnalysisChat";
import { AddData } from "./components/AddData";
import { Privacy } from "./components/Privacy";
import { ErrorBoundary } from "./components/ErrorBoundary";

type View = "overview" | "analysis" | "add" | "privacy";

const NAV: { key: View; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "analysis", label: "AI Analysis" },
  { key: "add", label: "Add data" },
  { key: "privacy", label: "Privacy" },
];

export default function App() {
  const load = useStore((s) => s.load);
  const loaded = useStore((s) => s.loaded);
  const hasData = useStore((s) => s.portfolio.holdings.length > 0);
  const [view, setView] = useState<View>("overview");

  useEffect(() => { void load(); }, [load]);

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
            <div className="tag">Private portfolio analysis · India</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={view === n.key ? "active" : ""} onClick={() => setView(n.key)}>
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
        <ErrorBoundary key={view}>
          {view === "overview" && <Overview />}
          {view === "analysis" && (hasData
            ? <AnalysisChat onConfigure={() => setView("privacy")} />
            : <Empty onAdd={() => setView("add")} />)}
          {view === "add" && <AddData />}
          {view === "privacy" && <Privacy />}
        </ErrorBoundary>
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
