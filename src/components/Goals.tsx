// Optional "Retirement outlook" card (Settings → Insights → Goals & retirement). A rough,
// deterministic projection of the investable corpus to the retirement year vs. the corpus needed
// to fund a desired income (25× / 4% rule). Assumptions persist in settings.retirement. India-
// first: figures are in the base currency. A read/estimate, not advice.
import { useStore } from "../storage/store";
import { fmtMoney } from "../regions/profile";
import { projectRetirement } from "../domain/retirement";

// India-typical defaults used until the user sets their own.
const D = {
  currentAge: 35,
  retireAge: 60,
  monthlyContribution: 0,
  desiredMonthlyIncome: 50_000,
  expectedReturnPct: 10,
  inflationPct: 6,
};

// Module-level so it doesn't remount each render (which would steal input focus mid-typing).
// Uses a text input bound to the value's canonical string (not type="number"): a controlled
// number input lets a leading zero stick because React won't rewrite "0150000" → "150000"
// (they're numerically equal). Here the displayed string is always String(value), so leading
// zeros never survive a render; 0 shows empty with a "0" placeholder so the user types onto a
// blank field, not in front of a "0".
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <>
      <label>{label}</label>
      <input
        type="text" inputMode="decimal" aria-label={label}
        value={value === 0 ? "" : String(value)} placeholder="0"
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9.]/g, "");
          const n = Number(cleaned);
          onChange(cleaned === "" || !Number.isFinite(n) ? 0 : n);
        }}
      />
    </>
  );
}

export function Goals({ currentCorpus }: { currentCorpus: number }) {
  const ret = useStore((s) => s.portfolio.settings.retirement);
  const updateSettings = useStore((s) => s.updateSettings);
  const v = { ...D, ...ret };
  const save = (patch: Partial<typeof D>) => updateSettings({ retirement: { ...ret, ...patch } });

  const p = projectRetirement({ currentCorpus, ...v });

  return (
    <div className="card">
      <div className="eyebrow">Retirement outlook · optional</div>
      <h3 style={{ fontSize: "1.1rem", margin: "0.2rem 0 0.35rem", fontFamily: "var(--font-display)" }}>Are you on track?</h3>
      <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 1rem", maxWidth: 640 }}>
        A rough projection from your investable corpus of <strong>{fmtMoney(Math.round(currentCorpus))}</strong>{" "}
        (excludes property) plus what you keep investing. Estimates — not advice.
      </p>

      <div className="list-grouped" style={{ marginBottom: "1.25rem", border: "1px solid var(--line-2)" }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 0 }}>
          <div className="form-col" style={{ padding: "0.55rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><NumField label="Age now" value={v.currentAge} onChange={(n) => save({ currentAge: n })} /></div>
          <div className="form-col" style={{ padding: "0.55rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><NumField label="Retire at" value={v.retireAge} onChange={(n) => save({ retireAge: n })} /></div>
          <div className="form-col" style={{ padding: "0.55rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><NumField label="Invest / month" value={v.monthlyContribution} onChange={(n) => save({ monthlyContribution: n })} /></div>
          <div className="form-col" style={{ padding: "0.55rem 0.8rem", borderRight: "1px solid var(--line-2)", borderBottom: "1px solid var(--line-2)" }}><NumField label="Target income / mo." value={v.desiredMonthlyIncome} onChange={(n) => save({ desiredMonthlyIncome: n })} /></div>
          <div className="form-col" style={{ padding: "0.55rem 0.8rem", borderRight: "1px solid var(--line-2)" }}><NumField label="Return % / yr" value={v.expectedReturnPct} onChange={(n) => save({ expectedReturnPct: n })} /></div>
          <div className="form-col" style={{ padding: "0.55rem 0.8rem" }}><NumField label="Inflation % / yr" value={v.inflationPct} onChange={(n) => save({ inflationPct: n })} /></div>
        </div>
      </div>

      <div className={`verdict ${p.tone}`} style={{ fontSize: "0.9rem" }}>
        <span className="dot" /> <strong>{p.headline}</strong>
      </div>
      <p className="muted" style={{ fontSize: "0.84rem", marginTop: "0.6rem", lineHeight: 1.6 }}>
        In {p.years} {p.years === 1 ? "year" : "years"} your corpus could reach{" "}
        <strong>{fmtMoney(Math.round(p.projectedCorpus))}</strong>. To draw about{" "}
        {fmtMoney(Math.round(p.desiredAnnualIncomeAtRetirement / 12))}/month then (your{" "}
        {fmtMoney(v.desiredMonthlyIncome)} grown by inflation), you'd want roughly{" "}
        <strong>{fmtMoney(Math.round(p.requiredCorpus))}</strong> set aside (the 25× / 4% rule) —{" "}
        {p.gap >= 0
          ? <>a surplus of <strong>{fmtMoney(Math.round(p.gap))}</strong>.</>
          : <>a shortfall of <strong>{fmtMoney(Math.round(-p.gap))}</strong>.</>}
      </p>
    </div>
  );
}
