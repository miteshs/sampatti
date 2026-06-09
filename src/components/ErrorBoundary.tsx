// Catches render-time crashes in a screen so a single component error degrades to a
// recoverable message instead of blank-screening the whole app. Data lives on disk, so a
// crash here never loses anything. Keyed by the active view in App so switching tabs clears it.

import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crashed:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card card-pad-lg" style={{ margin: "1rem 0" }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>Something went wrong on this screen</div>
        <p className="muted" style={{ margin: "0.5rem 0 0.9rem", maxWidth: 540 }}>
          Your data is safe on this device — nothing was lost. Try this screen again, switch tabs, or reload the app.
          {error.message ? <><br /><br /><code style={{ fontSize: "0.8rem" }}>{error.message}</code></> : null}
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn" onClick={() => location.reload()}>Reload app</button>
        </div>
      </div>
    );
  }
}
