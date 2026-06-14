import { useMemo, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { buildBrief, briefForModel } from "../domain/brief";
import { fmtMoney, profileFor } from "../regions/profile";
import { analysisReady, visiblePortfolio } from "../domain/types";
import { type Msg } from "../claude/transport";
import { engineFor, streamAnalysis } from "../ai/engine";
import { chatMessages, initialMessages, systemPrompt } from "../claude/prompts";
import { Markdown } from "./Markdown";

interface Turn { role: "assistant" | "user"; text: string }

// Areas the client can ask the review to emphasize (#2). These map to the analyst persona's
// own sections, so a pick deepens that section rather than asking for something off-script.
const FOCUS_OPTIONS = ["Tax", "Concentration", "Diversification", "Liquidity", "Retirement & income"];

export function AnalysisChat({ onConfigure }: { onConfigure?: () => void }) {
  const portfolio = useStore((s) => s.portfolio);
  const updateSettings = useStore((s) => s.updateSettings);
  const brief = useMemo(() => buildBrief(visiblePortfolio(portfolio)), [portfolio]);
  // What actually leaves the device: converted to the region's currency at the model edge.
  const outbound = useMemo(() => briefForModel(visiblePortfolio(portfolio)), [portfolio]);
  // Analysis conversation lives in the store (session-scoped) so it survives tab switches and
  // a clickable history can re-open past runs. See AnalysisRun in store.ts.
  const analyses = useStore((s) => s.analyses);
  const activeId = useStore((s) => s.activeAnalysisId);
  const streaming = useStore((s) => s.analysisStreaming);
  const newAnalysis = useStore((s) => s.newAnalysis);
  const setAnalysisTurns = useStore((s) => s.setAnalysisTurns);
  const setAnalysisStreaming = useStore((s) => s.setAnalysisStreaming);
  const selectAnalysis = useStore((s) => s.selectAnalysis);
  const deleteAnalysis = useStore((s) => s.deleteAnalysis);
  const active = useMemo(() => analyses.find((a) => a.id === activeId) ?? null, [analyses, activeId]);
  const turns = active?.turns ?? [];
  const started = !!active;
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  // Client tailoring: free-text goals/context (#1, persisted) + focus areas (#2, per-run).
  const [context, setContext] = useState(portfolio.settings.analysisContext ?? "");
  const [focus, setFocus] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const system = systemPrompt(portfolio.settings.country);
  const ready = analysisReady(portfolio.settings);
  const engine = engineFor("analysis");

  const tailoring = { context: context.trim() || undefined, focus: focus.length ? focus : undefined };
  // Persist the context only when it actually changed — keystroke writes would thrash the save.
  const persistContext = () => {
    if ((portfolio.settings.analysisContext ?? "") !== context) updateSettings({ analysisContext: context });
  };
  const toggleFocus = (f: string) =>
    setFocus((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  // Stream into the STORE (by run id), not component state, so an in-flight analysis keeps
  // filling in even if the user switches tabs (the component unmounts; the store doesn't).
  const run = async (messages: Msg[], id: string, seedTurns: Turn[]) => {
    setError(null);
    setAnalysisStreaming(true);
    setAnalysisTurns(id, [...seedTurns, { role: "assistant", text: "" }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamAnalysis(
        { model: portfolio.settings.analysisModel, system, max_tokens: 4000, messages },
        (delta) => {
          const cur = useStore.getState().analyses.find((a) => a.id === id);
          if (!cur || cur.turns.length === 0) return;
          const copy = [...cur.turns];
          copy[copy.length - 1] = { role: "assistant", text: copy[copy.length - 1].text + delta };
          setAnalysisTurns(id, copy);
        },
        ctrl.signal,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalysisStreaming(false);
    }
  };

  const title = focus.length ? `Review · ${focus.join(", ")}` : "Portfolio review";
  const start = () => {
    persistContext();
    const id = newAnalysis({ title, netWorth: brief.netWorth });
    void run(initialMessages(outbound, tailoring), id, []);
  };

  const askText = (q: string) => {
    if (!q || streaming || !active) return;
    setQuestion("");
    const history: Msg[] = active.turns.map((t) => ({ role: t.role, content: t.text }));
    const seed: Turn[] = [...active.turns, { role: "user", text: q }];
    void run(chatMessages(outbound, history, q, tailoring), active.id, seed);
  };
  const ask = () => askText(question.trim());

  // The real superpower for a non-technical user is asking in their own words — show them.
  // Example questions speak the market's language (the LIC question means nothing in the
  // US; wrapper-placement means nothing in India).
  const EXAMPLES = profileFor(portfolio.settings).region === "US"
    ? [
        "Am I too dependent on one stock?",
        "Should I prioritize my 401(k), Roth, or taxable account?",
        "How can I pay less tax on my gains this year?",
      ]
    : [
        "Am I too dependent on one stock?",
        "Should I continue my LIC / endowment policies?",
        "How can I pay less tax on my gains this year?",
      ];

  const c = brief.concentration;

  return (
    <div className="grid split-aside">
      <div className="grid" style={{ gap: "1rem" }}>
        <div className="card" style={{ display: "flex", gap: "0.7rem", alignItems: "center", background: "var(--primary-soft)" }}>
          <span style={{ fontSize: "1.3rem" }}>🔒</span>
          <div style={{ fontSize: "0.82rem", color: "var(--ink-2)" }}>
            {engine === "local" ? (
              <>Everything stays on this device — this analysis is written by the <strong>on-device
              model</strong> (quick take; switch to Claude in Settings for the deepest review). Nothing
              is sent anywhere.</>
            ) : (
              <>Your raw statements never leave this device. Only the compact <strong>portfolio brief</strong>{" "}
              on the right is sent to Claude ({portfolio.settings.claudeMode === "byo" ? "directly with your key" : "via the relay"}) to write this analysis.</>
            )}
          </div>
        </div>

        {!started ? (
          <div className="card card-pad-lg" style={{ textAlign: "center", padding: "2.5rem" }}>
            <div className="eyebrow">AI portfolio review</div>
            <h2 style={{ fontSize: "1.4rem", margin: "0.4rem 0 0.6rem" }}>
              {profileFor(portfolio.settings).region === "US"
                ? "A top US financial analyst, on your portfolio"
                : "A top Indian financial analyst, on your portfolio"}
            </h2>
            <p className="muted" style={{ maxWidth: 460, margin: "0 auto 1.25rem" }}>
              Concentration, diversification, {profileFor(portfolio.settings).region === "US" ? "US" : "India-specific"} tax
              planning, liquidity, and a retirement & income read — grounded in your actual
              numbers. Then ask anything.
            </p>
            {ready ? (
              <>
                <div style={{ maxWidth: 520, margin: "0 auto 1.25rem", textAlign: "left" }}>
                  <label htmlFor="analysis-context" className="muted" style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.35rem" }}>
                    Your goals &amp; context <span style={{ fontWeight: 400 }}>— optional, makes the review specific to you</span>
                  </label>
                  <textarea
                    id="analysis-context"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    onBlur={persistContext}
                    rows={3}
                    placeholder={profileFor(portfolio.settings).region === "US"
                      ? "e.g. I'm 45, hoping to retire at 60, two kids' college in 8–10 years, comfortable with moderate risk."
                      : "e.g. I'm 45, want to retire by 58, child's higher education in ~10 years, prefer low risk on near-term money."}
                    style={{ width: "100%", resize: "vertical", font: "inherit", padding: "0.55rem 0.65rem", borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--card)", boxSizing: "border-box" }}
                  />
                  <div className="muted" style={{ fontSize: "0.75rem", fontWeight: 600, margin: "0.7rem 0 0.35rem" }}>Focus the review on <span style={{ fontWeight: 400 }}>— optional</span></div>
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    {FOCUS_OPTIONS.map((f) => {
                      const on = focus.includes(f);
                      return (
                        <button
                          key={f}
                          type="button"
                          className="qchip"
                          aria-pressed={on}
                          onClick={() => toggleFocus(f)}
                          style={on ? { background: "var(--primary)", color: "var(--on-primary)", borderColor: "var(--primary)" } : {}}
                        >
                          {on ? "✓ " : ""}{f}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button className="btn btn-primary" style={{ fontSize: "0.95rem", padding: "0.7rem 1.5rem" }} onClick={start}>
                  ✨ Analyze my portfolio
                </button>
                <div style={{ marginTop: "1.4rem" }}>
                  <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                    Afterwards, ask anything in your own words — like:
                  </div>
                  <div style={{ display: "flex", gap: "0.45rem", justifyContent: "center", flexWrap: "wrap" }}>
                    {EXAMPLES.map((q) => (
                      <span key={q} className="qchip" style={{ cursor: "default" }}>“{q}”</span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ maxWidth: 460, margin: "0 auto", background: "var(--primary-soft)", border: "1px solid color-mix(in srgb, var(--primary) 22%, transparent)", borderRadius: 12, padding: "1rem 1.1rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: "0.3rem" }}>One quick step to enable AI analysis</div>
                <p className="muted" style={{ fontSize: "0.82rem", margin: "0 0 0.8rem" }}>
                  Connect Claude on the Settings tab (⚙) — add <strong>your own Anthropic key</strong> (most
                  private; it stays on this device) or a <strong>relay URL</strong>. Nothing runs until you do.
                </p>
                <button className="btn btn-primary" onClick={() => onConfigure?.()}>Open Settings to connect →</button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <div className="eyebrow" style={{ margin: 0 }}>{active?.title ?? "Portfolio review"}</div>
              <button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }}
                disabled={streaming} onClick={() => selectAnalysis(null)}>＋ New analysis</button>
            </div>
            {turns.map((t, i) => (
              <div key={i} className="card" style={t.role === "user" ? {
                background: "var(--primary-soft)", border: "1px solid color-mix(in srgb, var(--primary) 22%, transparent)", marginLeft: "2rem",
              } : {}}>
                {t.role === "user"
                  ? <div style={{ fontWeight: 600, color: "var(--primary)" }}>You: {t.text}</div>
                  : t.text
                    ? <Markdown text={t.text} />
                    : <span className="muted blink">Analyzing your portfolio…</span>}
              </div>
            ))}
            {error && (
              <div className="card" style={{ borderColor: "var(--rose-soft)", background: "var(--rose-soft)", color: "var(--rose)" }}>
                {error}
              </div>
            )}
            {!streaming && (
              <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                {EXAMPLES.map((q) => (
                  <button key={q} className="qchip" onClick={() => askText(q)}>{q}</button>
                ))}
              </div>
            )}
            <div className="card" style={{ display: "flex", gap: "0.5rem", position: "sticky", bottom: "1rem" }}>
              <input
                placeholder={streaming ? (engine === "local" ? "Thinking on this device…" : "Claude is responding…") : "Ask anything in your own words…"}
                value={question}
                disabled={streaming}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
              />
              <button className="btn btn-primary" onClick={ask} disabled={streaming || !question.trim()}>
                {streaming ? <span className="spinner" /> : "Ask"}
              </button>
            </div>
            <p className="muted" style={{ fontSize: "0.72rem", padding: "0 0.3rem" }}>
              Educational only — not a substitute for a personal {profileFor(portfolio.settings).adviserNoun}. Verify
              tax specifics for your situation and tax year.
            </p>
          </>
        )}

        {analyses.length > 0 && (
          <div className="card">
            <div className="eyebrow">Saved analyses · this session</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.4rem" }}>
              {[...analyses].reverse().map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <button
                    className="qchip"
                    onClick={() => selectAnalysis(a.id)}
                    aria-pressed={a.id === activeId}
                    style={{ flex: 1, textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: "0.6rem",
                      ...(a.id === activeId ? { background: "var(--primary)", color: "var(--on-primary)", borderColor: "var(--primary)" } : {}) }}
                  >
                    <span style={{ fontWeight: 600 }}>{a.title}</span>
                    <span style={{ opacity: 0.75, fontSize: "0.74rem", whiteSpace: "nowrap" }}>
                      {fmtMoney(a.netWorth)} · {new Date(a.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </span>
                  </button>
                  <button className="btn btn-ghost" title="Delete this analysis" style={{ padding: "0.15rem 0.45rem" }}
                    onClick={() => deleteAnalysis(a.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Deterministic facts panel — computed on-device, mirrors what Claude sees. */}
      <div className="card" style={{ position: "sticky", top: "1rem" }}>
        <div className="eyebrow">Computed on your device</div>
        <h3 style={{ fontSize: "1rem", margin: "0.2rem 0 0.8rem" }}>The brief sent to Claude</h3>
        <Fact label="Net worth" value={fmtMoney(brief.netWorth)} />
        <Fact label="Easy to reach" value={`${fmtMoney(brief.liquidAssets)} · ${brief.liquidPct}%`} />
        <Fact label="Biggest single stock" value={`${c.largestPctOfLiquid}% of liquid money`} />
        <Fact label="Top 5 stocks" value={`${c.top5PctOfLiquid}% of liquid money`} />
        <Fact label="Concentration score" value={String(c.hhi)} />
        {profileFor(portfolio.settings).region === "US" ? (
          <Fact label="Tax-advantaged (401k/Roth/HSA)" value={fmtMoney(brief.taxWrappers.usPretax + brief.taxWrappers.usRoth + brief.taxWrappers.usHsa)} />
        ) : (
          <Fact label="Tax-free savings (PF/PPF…)" value={fmtMoney(brief.taxWrappers.exemptEEE)} />
        )}
        <div style={{ marginTop: "0.8rem" }}>
          <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 600, marginBottom: "0.3rem" }}>Top asset classes</div>
          {brief.allocationByClass.slice(0, 5).map((a) => (
            <div key={a.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", padding: "0.15rem 0" }}>
              <span className="muted">{a.label}</span><span style={{ fontWeight: 600 }}>{a.percent}%</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: "0.68rem", marginTop: "0.7rem", lineHeight: 1.5 }}>
          The brief includes your top holdings’ <strong>names + account labels</strong> (so it can flag
          concentration). Your raw files, unit counts and buy dates are not sent.
        </p>
        <button className="btn btn-ghost" style={{ width: "100%", marginTop: "0.4rem", fontSize: "0.76rem" }} onClick={() => setShowBrief((v) => !v)}>
          {showBrief ? "Hide" : "🔍 Preview the exact JSON sent"}
        </button>
        {showBrief && (
          <pre style={{
            marginTop: "0.5rem", maxHeight: 300, overflow: "auto", background: "#0f172a", color: "#cbd5e1",
            fontSize: "0.66rem", lineHeight: 1.45, padding: "0.65rem", borderRadius: 8,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {JSON.stringify(outbound, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.7rem", padding: "0.3rem 0", borderBottom: "1px solid var(--line-2)" }}>
      <span className="muted" style={{ fontSize: "0.78rem" }}>{label}</span>
      {/* Right-align even when the value wraps to a second line. */}
      <span style={{ fontWeight: 700, fontSize: "0.84rem", textAlign: "right", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
