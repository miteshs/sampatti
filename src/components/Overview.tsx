import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { buildBrief } from "../domain/brief";
import { buildSegments, DIMENSIONS, type Dimension } from "../domain/group";
import { holdingBase, inr, pct } from "../domain/format";
import { ASSET_CLASS_LABEL, ACCOUNT_TYPE_LABEL } from "../domain/classify";
import { visiblePortfolio } from "../domain/types";
import { Donut } from "./Donut";
import { freshness, FRESH_BADGE } from "./ui";

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
      <div className="muted" style={{ fontSize: "0.74rem", fontWeight: 600 }}>{label}</div>
      <div style={{
        fontSize: accent ? "1.9rem" : "1.4rem", fontWeight: 800, marginTop: "0.2rem",
        letterSpacing: "-0.02em",
        ...(accent ? {
          background: "linear-gradient(135deg, var(--primary), var(--primary-2))",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        } : {}),
      }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: "0.74rem", marginTop: "0.15rem" }}>{sub}</div>}
    </div>
  );
}

export function Overview() {
  const portfolio = useStore((s) => s.portfolio);
  const updateAccount = useStore((s) => s.updateAccount);
  const removeAccount = useStore((s) => s.removeAccount);
  const [by, setBy] = useState<Dimension>("asset_class");
  const [focus, setFocus] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const usdInr = portfolio.settings.usdInr;

  // Everything the dashboard shows runs on the *visible* portfolio (excluded accounts
  // dropped), so the include/exclude toggle affects totals, allocation, and the table.
  const view = useMemo(() => visiblePortfolio(portfolio), [portfolio]);

  const brief = useMemo(() => buildBrief(view), [view]);
  const { total, segments } = useMemo(
    () => buildSegments(view.holdings, view.accounts, by, usdInr),
    [view, by, usdInr],
  );

  // Per-account totals from the *raw* portfolio so the management list shows a value even
  // for excluded accounts.
  const acctTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of portfolio.holdings) m.set(h.accountId, (m.get(h.accountId) ?? 0) + holdingBase(h, usdInr));
    return m;
  }, [portfolio.holdings, usdInr]);

  const acctById = useMemo(() => new Map(view.accounts.map((a) => [a.id, a])), [view.accounts]);
  const rows = useMemo(() => {
    const list = view.holdings
      .map((h) => ({ h, a: acctById.get(h.accountId), base: holdingBase(h, usdInr) }))
      .filter((x) => x.a?.accountType !== "liability")
      .sort((x, y) => y.base - x.base);
    if (!focus) return list;
    // Filter the table to the clicked segment, interpreting the key for the active dimension.
    return list.filter(({ h, a }) => {
      switch (by) {
        case "asset_class": return h.assetClass === focus;
        case "account": return a?.id === focus;
        case "region": return (a?.region ?? "India") === focus;
        case "tax": return (a?.taxTreatment ?? "taxable") === focus;
        case "account_type": return (a?.accountType ?? "other") === focus;
        case "institution": return (a?.institution ?? "—") === focus;
      }
    });
  }, [view.holdings, acctById, usdInr, focus, by]);

  const staleAccounts = view.accounts
    .filter((a) => a.accountType !== "liability" && a.accountType !== "income")
    .map((a) => ({ a, f: freshness(a.asOf) }))
    .filter((x) => x.f.status !== "fresh")
    .sort((x, y) => (y.f.days ?? 1e9) - (x.f.days ?? 1e9));

  if (portfolio.accounts.length === 0) {
    return (
      <div className="card card-pad-lg" style={{ textAlign: "center", padding: "3rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>No data yet</div>
        <p className="muted" style={{ maxWidth: 420, margin: "0.5rem auto 0" }}>
          Go to <strong>Add data</strong> to import a statement or enter accounts manually —
          or load the demo portfolio to explore.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: "1.25rem" }}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <StatCard label="Net worth" value={inr(brief.netWorth)} sub={`${inr(brief.totalAssets)} assets · ${inr(brief.totalLiabilities)} debt`} accent />
        <StatCard label="Liquid assets" value={inr(brief.liquidAssets)} sub={`${brief.liquidPct}% of assets`} />
        <StatCard label="Largest single stock" value={`${brief.concentration.largestPctOfLiquid}%`} sub="of liquid assets" />
        <StatCard label="Annual income" value={inr(brief.income.annualTotal)} sub={brief.income.netWorthYears ? `net worth ≈ ${brief.income.netWorthYears}× income` : undefined} />
      </div>

      {/* Accounts — include/exclude from the view & analysis, or remove entirely */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <div className="eyebrow">Accounts</div>
            <h2 style={{ fontSize: "1.05rem", marginTop: "0.15rem" }}>Include or remove accounts</h2>
          </div>
          <span className="muted" style={{ fontSize: "0.78rem", maxWidth: 280, textAlign: "right" }}>
            Unchecked accounts are left out of net worth, allocations &amp; AI analysis.
          </span>
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          {portfolio.accounts.map((a) => {
            const excluded = !!a.excluded;
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.7rem", padding: "0.5rem 0", borderTop: "1px solid var(--line-2)", opacity: excluded ? 0.55 : 1 }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", flex: 1, minWidth: 0 }}>
                  <input type="checkbox" checked={!excluded} onChange={() => updateAccount(a.id, { excluded: !excluded })} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 600 }}>{a.name}</span>
                    <span className="muted" style={{ fontSize: "0.8rem" }}> · {a.institution || "—"} · {ACCOUNT_TYPE_LABEL[a.accountType]}</span>
                  </span>
                </label>
                <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span className="num muted" style={{ fontSize: "0.84rem" }}>{inr(acctTotals.get(a.id) ?? 0)}</span>
                  {confirmRemove === a.id ? (
                    <>
                      <button className="btn btn-danger" style={{ padding: "0.2rem 0.55rem" }} onClick={() => { removeAccount(a.id); setConfirmRemove(null); }}>Remove</button>
                      <button className="btn btn-ghost" style={{ padding: "0.2rem 0.5rem" }} onClick={() => setConfirmRemove(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn btn-ghost" style={{ padding: "0.2rem 0.55rem" }} title="Remove account" onClick={() => setConfirmRemove(a.id)}>✕</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {view.holdings.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "1.5rem" }}>
          <span className="muted">All accounts are excluded — re-include one above to see allocations and holdings.</span>
        </div>
      ) : (<>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1rem" }}>
          <div>
            <div className="eyebrow">Allocation</div>
            <h2 style={{ fontSize: "1.15rem", marginTop: "0.15rem" }}>Where your money sits</h2>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {DIMENSIONS.map((d) => (
              <button key={d.key} className={`chip ${by === d.key ? "active" : ""}`}
                onClick={() => { setBy(d.key); setFocus(null); }}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <Donut segments={segments} total={total} onSelect={(k) => setFocus(focus === k ? null : k)} />
        {focus && (
          <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.75rem" }}>
            Filtering holdings to <strong>{segments.find((s) => s.key === focus)?.label}</strong> ·{" "}
            <span style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => setFocus(null)}>clear</span>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.05rem", marginBottom: "0.6rem" }}>Holdings</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Holding</th><th>Account</th><th>Class</th>
                <th className="num">Value</th><th className="num">% assets</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, a, base }) => (
                <tr key={h.id}>
                  <td style={{ fontWeight: 600 }}>{h.name}
                    {h.currency !== "INR" && <span className="muted" style={{ fontWeight: 400 }}> · {h.currency}</span>}
                  </td>
                  <td className="muted">{a?.name}</td>
                  <td><span className="badge badge-gray">{ASSET_CLASS_LABEL[h.assetClass]}</span></td>
                  <td className="num" style={{ fontWeight: 600 }}>{inr(base)}</td>
                  <td className="num muted">{pct(base, brief.totalAssets)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1.05rem" }}>Data freshness</h2>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            {staleAccounts.length === 0 ? "Everything is current" : `${staleAccounts.length} account(s) could use a fresh statement`}
          </span>
        </div>
        {staleAccounts.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            {staleAccounts.map(({ a, f }) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0", borderTop: "1px solid var(--line-2)" }}>
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                <span style={{ display: "flex", gap: "0.8rem", alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    {a.asOf ? `as of ${a.asOf}${f.days != null ? ` · ${f.days}d ago` : ""}` : "no date"}
                  </span>
                  <span className={`badge ${FRESH_BADGE[f.status]}`}>{f.status}</span>
                </span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.6rem" }}>
              Statement values are held until you import a newer one. Amber ≈ 1–4 months old, red ≈ older.
            </p>
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}
