// Shown when the relay rejects the access code (40x) — points the user at Settings to update it.
// Also imported by AnalysisChat, so it lives in its own module.
export function AuthErrorModal({ onClose, onConfigure }: { onClose: () => void; onConfigure?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="AI access error" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center", padding: "2.2rem 1.8rem" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.8rem" }}>🔑</div>
        <h3 style={{ fontSize: "1.25rem", margin: "0 0 0.6rem" }}>AI access code issue</h3>
        <p className="muted" style={{ fontSize: "0.92rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
          Your AI access code is missing or no longer working.
          Please <strong>ask the developer for a new code</strong> to enable automatic analysis and statement imports.
        </p>
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={() => { onClose(); onConfigure?.(); }}>Update code in Settings</button>
          <button className="btn btn-ghost" onClick={onClose}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
