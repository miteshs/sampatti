// Performance tab — unrealized P&L per holding, computed from cost basis. Two kinds of basis
// coexist (see types.ts): a REAL purchase cost from a statement or the user, and a since-first-
// import anchor (costBasisEstimated) for holdings nobody knows the cost of — those rows are
// marked ≈ and their "gain" reads "change since Sampatti first saw this holding".

import { useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio, type Account, type Holding } from "../domain/types";
import { holdingBase, holdingGain, inr, pct, type HoldingGain } from "../domain/format";
import { ASSET_CLASS_LABEL } from "../domain/classify";

const GREEN = "#1a9e6b", RED = "#d6455d";
const signColor = (n: number) => (n >= 0 ? GREEN : RED);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${inr(Math.abs(n))}`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n}%`;

// "6.9 y" / "8 mo" since the buy date — the holding-period column (and the seed of the
// LTCG/STCG tooling to come).
function heldFor(buyDate?: string): string | null {
  if (!buyDate) return null;
  const ms = Date.now() - new Date(buyDate).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const years = ms / (365.25 * 86_400_000);
  return years >= 1 ? `${years.toFixed(1)} y` : `${Math.max(1, Math.round(years * 12))} mo`;
}

interface RowData { h: Holding; a?: Account; value: number; g: HoldingGain | null; }

type SortKey = "gainers" | "losers" | "largest";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "gainers", label: "Top gainers" },
  { key: "losers", label: "Top losers" },
  { key: "largest", label: "Largest" },
];

export function Performance() {
  const portfolio = useStore((s) => s.portfolio);
  const usdInr = portfolio.settings.usdInr;
  const view = useMemo(() => visiblePortfolio(portfolio), [portfolio]);
  const [sort, setSort] = useState<SortKey>("gainers");

  const rows = useMemo<RowData[]>(() => {
    const acctById = new Map(view.accounts.map((a) => [a.id, a]));
    return view.holdings
      .filter((h) => {
        const t = acctById.get(h.accountId)?.accountType;
        return t !== "liability" && t !== "income"; // P&L on a loan makes no sense
      })
      .map((h) => ({ h, a: acctById.get(h.accountId), value: holdingBase(h, usdInr), g: holdingGain(h, usdInr) }));
  }, [view, usdInr]);

  const sorted = useMemo(() => {
    const s = [...rows];
    const pctOf = (r: RowData) => (r.g?.gainPct ?? null);
    if (sort === "largest") s.sort((a, b) => b.value - a.value);
    else
      s.sort((a, b) => {
        const pa = pctOf(a), pb = pctOf(b);
        if (pa == null && pb == null) return b.value - a.value;
        if (pa == null) return 1; // basis-less rows sink to the bottom
        if (pb == null) return -1;
        return sort === "gainers" ? pb - pa : pa - pb;
      });
    return s;
  }, [rows, sort]);

  const totals = useMemo(() => {
    let invested = 0, gain = 0, realValue = 0, value = 0, up = 0, down = 0;
    for (const r of rows) {
      value += r.value;
      if (!r.g) continue;
      invested += r.g.invested;
      gain += r.g.gain;
      if (!r.g.estimated) realValue += r.value;
      if (Math.round(r.g.gain) > 0) up += 1;
      else if (Math.round(r.g.gain) < 0) down += 1;
    }
    return {
      invested, gain, value, up, down,
      gainPct: invested > 0 ? Math.round((gain / invested) * 1000) / 10 : 0,
      realPct: pct(realValue, value),
    };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="card card-pad-lg" style={{ textAlign: "center", padding: "3rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>Nothing to measure yet</div>
        <p className="muted" style={{ maxWidth: 420, margin: "0.5rem auto 0" }}>
          Add or import holdings first — then this tab shows each one's unrealized gain or loss.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: "1.25rem" }}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
          <div className="eyebrow">Unrealized P&amp;L</div>
          <div style={{ fontSize: "1.95rem", fontWeight: 750, marginTop: "0.25rem", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: signColor(totals.gain) }}>
            {signed(totals.gain)}
          </div>
          <div className="muted" style={{ fontSize: "0.74rem", marginTop: "0.15rem" }}>
            {signedPct(totals.gainPct)} on {inr(totals.invested)} invested
          </div>
        </div>
        <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
          <div className="eyebrow">Winners vs losers</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 750, marginTop: "0.25rem", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: GREEN }}>{totals.up} up</span>
            <span className="muted" style={{ fontWeight: 400 }}> · </span>
            <span style={{ color: RED }}>{totals.down} down</span>
          </div>
          <div className="muted" style={{ fontSize: "0.74rem", marginTop: "0.15rem" }}>of {rows.length} holdings</div>
        </div>
        <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
          <div className="eyebrow">Real cost basis</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 750, marginTop: "0.25rem", fontVariantNumeric: "tabular-nums" }}>{totals.realPct}%</div>
          <div className="muted" style={{ fontSize: "0.74rem", marginTop: "0.15rem" }}>
            of value has a true purchase cost — the rest is measured since first import (≈)
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.6rem" }}>
          <div>
            <div className="eyebrow">Unrealized gains</div>
            <h2 style={{ fontSize: "1.15rem", marginTop: "0.15rem" }}>Every holding, winners to losers</h2>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {SORTS.map((s) => (
              <button key={s.key} className={`chip ${sort === s.key ? "active" : ""}`} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Holding</th>
                <th>Class</th>
                <th className="num">Held</th>
                <th className="num">Invested</th>
                <th className="num">Value</th>
                <th className="num">P&amp;L</th>
                <th className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ h, a, value, g }) => {
                const held = heldFor(h.buyDate);
                return (
                  <tr key={h.id} style={{ borderTop: "1px solid var(--line-2)" }}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{h.name}</span>
                      <span className="muted" style={{ fontSize: "0.78rem" }}> · {a?.name}</span>
                      {h.currency !== "INR" && <span className="muted" style={{ fontSize: "0.78rem" }}> · {h.currency}</span>}
                    </td>
                    <td><span className="badge badge-gray">{ASSET_CLASS_LABEL[h.assetClass]}</span></td>
                    <td className="num muted" style={{ fontSize: "0.84rem" }}>{held ?? "—"}</td>
                    <td className="num">{g ? <>{g.estimated && <span className="muted" title="No purchase cost on file — value when first imported">≈ </span>}{inr(g.invested)}</> : "—"}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{inr(value)}</td>
                    <td className="num" style={{ fontWeight: 600, color: g ? signColor(g.gain) : undefined }}>{g ? signed(g.gain) : "—"}</td>
                    <td className="num" style={{ color: g ? signColor(g.gain) : undefined }}>{g?.gainPct != null ? signedPct(g.gainPct) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.6rem" }}>
          ≈ — no purchase cost was on the statement, so the gain is measured from the value when the
          holding first entered Sampatti. Add the real cost in <strong>Manage → ✎</strong> for true P&amp;L.
          USD positions convert at today's ₹{usdInr}/$ for both cost and value, so their P&amp;L is price
          movement only (no FX effect).
        </p>
      </div>
    </div>
  );
}
