import { useMemo, useRef, useState } from "react";
import { useStore } from "../storage/store";
import { buildBrief } from "../domain/brief";
import { profileFor } from "../regions/profile";
import { analysisReady, visiblePortfolio } from "../domain/types";
import { type Msg } from "../claude/transport";
import { engineFor, streamAnalysis } from "../ai/engine";
import { chatMessages, initialMessages, systemPrompt } from "../claude/prompts";
import { Markdown } from "./Markdown";

interface Turn { role: "assistant" | "user"; text: string }

export function AnalysisChat({ onConfigure }: { onConfigure?: () => void }) {
  const portfolio = useStore((s) => s.portfolio);
  // Brief values arrive ALREADY in the region's currency (buildBrief converts at the
  // edge) — format raw, or USD briefs would convert twice through fmtMoney.
  const fmtBrief = profileFor(portfolio.settings).formatMoney;
  const brief = useMemo(() => buildBrief(visiblePortfolio(portfolio)), [portfolio]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [started, setStarted] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const system = systemPrompt(portfolio.settings.country);
  const ready = analysisReady(portfolio.settings);
  const engine = engineFor("analysis");

  const run = async (messages: Msg[], seedTurns: Turn[]) => {
    setError(null);
    setStreaming(true);
    setTurns([...seedTurns, { role: "assistant", text: "" }]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamAnalysis(
        { model: portfolio.settings.analysisModel, system, max_tokens: 4000, messages },
        (delta) => setTurns((t) => {
          const copy = [...t];
          copy[copy.length - 1] = { role: "assistant", text: copy[copy.length - 1].text + delta };
          return copy;
        }),
        ctrl.signal,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  };

  const start = () => { setStarted(true); void run(initialMessages(brief), []); };

  const askText = (q: string) => {
    if (!q || streaming) return;
    setQuestion("");
    const history: Msg[] = turns.map((t) => ({ role: t.role, content: t.text }));
    const seed: Turn[] = [...turns, { role: "user", text: q }];
    void run(chatMessages(brief, history, q), seed);
  };
  const ask = () => askText(question.trim());

  // The real superpower for a non-technical user is asking in their own words — show them.
  const EXAMPLES = [
    "Am I too dependent on one stock?",
    "Should I continue my LIC / endowment policies?",
    "How can I pay less tax on my gains this year?",
  ];

  const c = brief.concentration;

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "1.25rem", alignItems: "start" }}>
      <div className="grid" style={{ gap: "1rem" }}>
        <div className="card" style={{ display: "flex", gap: "0.7rem", alignItems: "center", background: "linear-gradient(135deg, #f3f1ff, #ffffff)" }}>
          <span style={{ fontSize: "1.3rem" }}>🔒</span>
          <div style={{ fontSize: "0.82rem", color: "var(--ink-2)" }}>
            {engine === "local" ? (
              <>Everything stays on this device — this analysis is written by the <strong>on-device
              model</strong> (quick take; switch to Claude on Privacy for the deepest review). Nothing
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
              A top Indian financial analyst, on your portfolio
            </h2>
            <p className="muted" style={{ maxWidth: 460, margin: "0 auto 1.25rem" }}>
              Concentration, diversification, India-specific tax planning, liquidity, and a
              retirement & income read — grounded in your actual numbers. Then ask anything.
            </p>
            {ready ? (
              <>
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
              <div style={{ maxWidth: 460, margin: "0 auto", background: "var(--primary-soft)", border: "1px solid #e0e0ff", borderRadius: 12, padding: "1rem 1.1rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.92rem", marginBottom: "0.3rem" }}>One quick step to enable AI analysis</div>
                <p className="muted" style={{ fontSize: "0.82rem", margin: "0 0 0.8rem" }}>
                  Connect Claude on the Privacy screen — add <strong>your own Anthropic key</strong> (most
                  private; it stays on this device) or a <strong>relay URL</strong>. Nothing runs until you do.
                </p>
                <button className="btn btn-primary" onClick={() => onConfigure?.()}>Open Privacy &amp; connect →</button>
              </div>
            )}
          </div>
        ) : (
          <>
            {turns.map((t, i) => (
              <div key={i} className="card" style={t.role === "user" ? {
                background: "var(--primary-soft)", border: "1px solid #e0e0ff", marginLeft: "2rem",
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
              Educational only — not a substitute for a SEBI-registered investment adviser. Verify
              tax specifics for your situation and assessment year.
            </p>
          </>
        )}
      </div>

      {/* Deterministic facts panel — computed on-device, mirrors what Claude sees. */}
      <div className="card" style={{ position: "sticky", top: "1rem" }}>
        <div className="eyebrow">Computed on your device</div>
        <h3 style={{ fontSize: "1rem", margin: "0.2rem 0 0.8rem" }}>The brief sent to Claude</h3>
        <Fact label="Net worth" value={fmtBrief(brief.netWorth)} />
        <Fact label="Easy to reach" value={`${fmtBrief(brief.liquidAssets)} · ${brief.liquidPct}%`} />
        <Fact label="Biggest single stock" value={`${c.largestPctOfLiquid}% of liquid money`} />
        <Fact label="Top 5 stocks" value={`${c.top5PctOfLiquid}% of liquid money`} />
        <Fact label="Concentration score" value={String(c.hhi)} />
        <Fact label="Tax-free savings (PF/PPF…)" value={fmtBrief(brief.taxWrappers.exemptEEE)} />
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
            {JSON.stringify(brief, null, 2)}
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
