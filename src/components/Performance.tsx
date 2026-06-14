// Performance tab — unrealized P&L per holding, computed STRICTLY from real purchase costs:
// a holding with no cost basis on file (or only the since-first-import estimate) is left out
// of the P&L table and totals entirely, and the coverage card says how much of the portfolio
// that leaves unmeasured. No simulation here — the chart is the recorded per-account stack.

import { Fragment, useMemo, useState } from "react";
import { useStore } from "../storage/store";
import { visiblePortfolio, type Account, type Holding } from "../domain/types";
import { holdingBase, holdingGain, pct, type HoldingGain } from "../domain/format";
import { currentProfile, fmtMoney } from "../regions/profile";
import { ASSET_CLASS_LABEL } from "../domain/classify";
import { groupHoldings, tickerOf, type GroupedHolding } from "../domain/aggregate";
import { AccountStack } from "./AccountStack";

const GREEN = "var(--up-ink)", RED = "var(--down-ink)"; // theme tokens (light/dark, text-grade ≥4.5:1)
const signColor = (n: number) => (n >= 0 ? GREEN : RED);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${fmtMoney(Math.abs(n))}`;
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

// Column sorting: click a header to cycle ascending/descending (text columns start
// ascending, numeric descending); picking a chip returns to its canonical order. In
// "By account" the sort applies INSIDE each account group — never across boundaries
// (groups themselves stay ordered by measured value).
export type ColKey = "name" | "class" | "held" | "invested" | "value" | "gain" | "gainPct";
const TEXT_COLS = new Set<ColKey>(["name", "class"]);
export type ColSort = { col: ColKey; dir: "asc" | "desc" };
export function nextColSort(prev: ColSort | null, col: ColKey): ColSort {
  if (prev?.col === col) return { col, dir: prev.dir === "desc" ? "asc" : "desc" };
  return { col, dir: TEXT_COLS.has(col) ? "asc" : "desc" };
}
export function compareRows(col: ColKey, dir: "asc" | "desc") {
  const sgn = dir === "asc" ? 1 : -1;
  const get = (r: RowData): string | number | null => {
    switch (col) {
      case "name": return r.h.name.toLowerCase();
      case "class": return (ASSET_CLASS_LABEL[r.h.assetClass] ?? "").toLowerCase();
      case "held": return r.h.buyDate ? Date.now() - new Date(r.h.buyDate).getTime() : null;
      case "invested": return r.g?.invested ?? null;
      case "value": return r.value;
      case "gain": return r.g?.gain ?? null;
      case "gainPct": return r.g?.gainPct ?? null;
    }
  };
  return (a: RowData, b: RowData): number => {
    const va = get(a), vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // unknowns sink, whichever direction
    if (vb == null) return -1;
    if (typeof va === "string") return sgn * va.localeCompare(vb as string);
    return sgn * (va - (vb as number));
  };
}

// One P&L table row. In the by-account view the rows sit under their account's subtotal
// header, so the account suffix is dropped and the name indents.
function SortTH({ col, colSort, onSort, num, style, children }: {
  col: ColKey; colSort: ColSort | null; onSort: (s: ColSort) => void;
  num?: boolean; style?: React.CSSProperties; children: React.ReactNode;
}) {
  const active = colSort?.col === col;
  return (
    <th className={num ? "num" : undefined} style={style}
      aria-sort={active ? (colSort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        onClick={() => onSort(nextColSort(colSort, col))}
        title="Sort by this column"
        style={{
          background: "none", border: 0, padding: 0, font: "inherit", color: "inherit",
          letterSpacing: "inherit", textTransform: "inherit", cursor: "pointer",
          width: "100%", textAlign: num ? "right" : "left",
        }}
      >
        {children}
        {active && <span aria-hidden style={{ fontSize: "0.6rem", marginLeft: 4, opacity: 0.85 }}>{colSort.dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function HoldingRow({ row: { h, a, value, g }, grouped }: { row: RowData; grouped?: boolean }) {
  const held = heldFor(h.buyDate);
  return (
    <tr style={{ borderTop: "1px solid var(--line-2)" }} data-focus-key={`id:${h.id}`}>
      <td style={grouped ? { paddingLeft: "1.6rem" } : undefined}>
        <span style={{ fontWeight: 600 }}>{h.name}</span>
        {tickerOf(h.symbol, h.assetClass) && <span className="muted" style={{ fontSize: "0.78rem" }}> ({tickerOf(h.symbol, h.assetClass)})</span>}
        {!grouped && <span className="muted" style={{ fontSize: "0.78rem" }}> · {a?.name}</span>}
        {h.currency !== "INR" && <span className="muted" style={{ fontSize: "0.78rem" }}> · {h.currency}</span>}
      </td>
      <td><span className="badge badge-gray">{ASSET_CLASS_LABEL[h.assetClass]}</span></td>
      <td className="num muted" style={{ fontSize: "0.84rem" }}>{held ?? "—"}</td>
      <td className="num">{g ? fmtMoney(g.invested) : "—"}</td>
      <td className="num" style={{ fontWeight: 600 }}>{fmtMoney(value)}</td>
      <td className="num" style={{ fontWeight: 600, color: g ? signColor(g.gain) : undefined }}>{g ? signed(g.gain) : "—"}</td>
      <td className="num" style={{ color: g ? signColor(g.gain) : undefined }}>{g?.gainPct != null ? signedPct(g.gainPct) : "—"}</td>
    </tr>
  );
}

// Column comparator for the instrument-clubbed view (mirrors compareRows over GroupedHolding).
function compareClubbed(col: ColKey, dir: "asc" | "desc") {
  const sgn = dir === "asc" ? 1 : -1;
  return (a: GroupedHolding, b: GroupedHolding) => {
    let va: string | number, vb: string | number;
    switch (col) {
      case "name": va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
      case "class": va = ASSET_CLASS_LABEL[a.assetClass]; vb = ASSET_CLASS_LABEL[b.assetClass]; break;
      case "invested": va = a.gain?.invested ?? 0; vb = b.gain?.invested ?? 0; break;
      case "gain": va = a.gain?.gain ?? 0; vb = b.gain?.gain ?? 0; break;
      case "gainPct": va = a.gain?.gainPct ?? -Infinity; vb = b.gain?.gainPct ?? -Infinity; break;
      case "held": return 0; // a clubbed row spans accounts/dates — no single held-for
      case "value": default: va = a.value; vb = b.value; break;
    }
    if (typeof va === "string") return sgn * va.localeCompare(vb as string);
    return sgn * (va - (vb as number));
  };
}

// One instrument-clubbed P&L row (same columns as HoldingRow; held-for is blank since it spans
// accounts/buy-dates). Value/P&L are summed over the real-basis legs.
function ClubbedRow({ g }: { g: GroupedHolding }) {
  return (
    <tr style={{ borderTop: "1px solid var(--line-2)" }} data-focus-key={g.key}>
      <td>
        <span style={{ fontWeight: 600 }}>{g.name}</span>
        {tickerOf(g.symbol, g.assetClass) && <span className="muted" style={{ fontSize: "0.78rem" }}> ({tickerOf(g.symbol, g.assetClass)})</span>}
        {g.legs > 1 && <span className="badge badge-gray" style={{ marginLeft: "0.35rem", fontSize: "0.66rem" }} title={g.accounts.join(", ")}>{g.legs} accounts</span>}
      </td>
      <td><span className="badge badge-gray">{ASSET_CLASS_LABEL[g.assetClass]}</span></td>
      <td className="num muted" style={{ fontSize: "0.84rem" }}>—</td>
      <td className="num">{g.gain ? fmtMoney(g.gain.invested) : "—"}</td>
      <td className="num" style={{ fontWeight: 600 }}>{fmtMoney(g.value)}</td>
      <td className="num" style={{ fontWeight: 600, color: g.gain ? signColor(g.gain.gain) : undefined }}>{g.gain ? signed(g.gain.gain) : "—"}</td>
      <td className="num" style={{ color: g.gain ? signColor(g.gain.gain) : undefined }}>{g.gain?.gainPct != null ? signedPct(g.gain.gainPct) : "—"}</td>
    </tr>
  );
}

type SortKey = "gainers" | "losers" | "largest" | "by_account";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "gainers", label: "Top gainers" },
  { key: "losers", label: "Top losers" },
  { key: "largest", label: "Largest" },
  { key: "by_account", label: "By account" },
];

export function Performance() {
  const portfolio = useStore((s) => s.portfolio);
  const usdInr = portfolio.settings.usdInr;
  const view = useMemo(() => visiblePortfolio(portfolio), [portfolio]);
  const [sort, setSort] = useState<SortKey>("gainers");
  const [colSort, setColSort] = useState<ColSort | null>(null);

  const { rows, unmeasured } = useMemo(() => {
    const acctById = new Map(view.accounts.map((a) => [a.id, a]));
    const assets = view.holdings.filter((h) => {
      const t = acctById.get(h.accountId)?.accountType;
      return t !== "liability" && t !== "income"; // P&L on a loan makes no sense
    });
    const all = assets.map((h) => ({ h, a: acctById.get(h.accountId), value: holdingBase(h, usdInr), g: holdingGain(h, usdInr) }));
    // Real purchase costs only — an estimated (since-first-import) basis is not a cost,
    // so those holdings are excluded rather than shown with a fake-looking P&L.
    const rows: RowData[] = all.filter((r) => r.g != null && !r.g.estimated);
    const left = all.filter((r) => r.g == null || r.g.estimated);
    return {
      rows,
      unmeasured: {
        count: left.length,
        value: left.reduce((s, r) => s + r.value, 0),
        totalValue: all.reduce((s, r) => s + r.value, 0),
      },
    };
  }, [view, usdInr]);

  const sorted = useMemo(() => {
    const s = [...rows];
    const pctOf = (r: RowData) => (r.g?.gainPct ?? null);
    if (sort === "largest" || sort === "by_account") s.sort((a, b) => b.value - a.value);
    else
      s.sort((a, b) => {
        const pa = pctOf(a), pb = pctOf(b);
        if (pa == null && pb == null) return b.value - a.value;
        if (pa == null) return 1; // basis-less rows sink to the bottom
        if (pb == null) return -1;
        return sort === "gainers" ? pb - pa : pa - pb;
      });
    if (colSort) s.sort(compareRows(colSort.col, colSort.dir));
    return s;
  }, [rows, sort, colSort]);

  // "By account": the same measured rows, bucketed under their account with subtotals —
  // accounts ordered by measured value, holdings inside by value.
  const byAccount = useMemo(() => {
    if (sort !== "by_account") return null;
    const groups = new Map<string, { a?: Account; rows: RowData[] }>();
    for (const r of sorted) {
      const key = r.a?.id ?? "?";
      const g = groups.get(key) ?? { a: r.a, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => {
        const invested = g.rows.reduce((s, r) => s + (r.g?.invested ?? 0), 0);
        const value = g.rows.reduce((s, r) => s + r.value, 0);
        const gain = g.rows.reduce((s, r) => s + (r.g?.gain ?? 0), 0);
        return { ...g, invested, value, gain, gainPct: invested > 0 ? Math.round((gain / invested) * 1000) / 10 : null };
      })
      .sort((x, y) => y.value - x.value);
  }, [sort, sorted]);

  // Instrument-clubbed view for the gainers/losers/largest sorts: the same instrument held in
  // several accounts becomes one row (value + P&L summed). "By account" stays per-account.
  const clubbedSorted = useMemo(() => {
    const list = groupHoldings(rows.map((r) => r.h), view.accounts, usdInr);
    if (sort === "largest") list.sort((a, b) => b.value - a.value);
    else list.sort((a, b) => {
      const pa = a.gain?.gainPct ?? null, pb = b.gain?.gainPct ?? null;
      if (pa == null && pb == null) return b.value - a.value;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return sort === "gainers" ? pb - pa : pa - pb;
    });
    if (colSort) list.sort(compareClubbed(colSort.col, colSort.dir));
    return list;
  }, [rows, view.accounts, usdInr, sort, colSort]);

  const totals = useMemo(() => {
    let invested = 0, gain = 0, up = 0, down = 0;
    for (const r of rows) {
      if (!r.g) continue;
      invested += r.g.invested;
      gain += r.g.gain;
      if (Math.round(r.g.gain) > 0) up += 1;
      else if (Math.round(r.g.gain) < 0) down += 1;
    }
    return {
      invested, gain, up, down,
      gainPct: invested > 0 ? Math.round((gain / invested) * 1000) / 10 : 0,
      coveredPct: pct(unmeasured.totalValue - unmeasured.value, unmeasured.totalValue),
    };
  }, [rows, unmeasured]);

  if (rows.length === 0 && unmeasured.count === 0) {
    return (
      <div className="card card-pad-lg" style={{ textAlign: "center", padding: "3rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>Nothing to measure yet</div>
        <p className="muted" style={{ maxWidth: 420, margin: "0.5rem auto 0" }}>
          Add or import holdings first — then this tab shows each one's gain or loss.
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: "1.25rem" }}>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))" }}>
        <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
          <div className="eyebrow">Profit so far (on paper)</div>
          <div style={{ fontSize: "1.95rem", fontWeight: 750, marginTop: "0.25rem", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: signColor(totals.gain) }}>
            {signed(totals.gain)}
          </div>
          <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>
            {signedPct(totals.gainPct)} on the {fmtMoney(totals.invested)} you put in — holdings with a real purchase cost only
          </div>
        </div>
        <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
          <div className="eyebrow">Winners vs losers</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 750, marginTop: "0.25rem", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: GREEN }}>{totals.up} up</span>
            <span className="muted" style={{ fontWeight: 400 }}> · </span>
            <span style={{ color: RED }}>{totals.down} down</span>
          </div>
          <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>of the {rows.length} measured holdings</div>
        </div>
        <div className="card" style={{ padding: "1.1rem 1.25rem" }}>
          <div className="eyebrow">Measured</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 750, marginTop: "0.25rem", fontVariantNumeric: "tabular-nums" }}>{totals.coveredPct}%</div>
          <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>
            {unmeasured.count === 0
              ? "every holding has a purchase cost on file"
              : `of value — ${unmeasured.count} holding${unmeasured.count === 1 ? "" : "s"} (${fmtMoney(unmeasured.value)}) have no purchase cost and aren't shown; add costs in Manage → ✎`}
          </div>
        </div>
      </div>

      {/* The recorded daily values, stacked one band per account — no simulation. */}
      <AccountStack />

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.6rem" }}>
          <div>
            <div className="eyebrow">Profit &amp; loss by holding</div>
            <h2 style={{ fontSize: "1.3rem", marginTop: "0.15rem" }}>Every holding, winners to losers</h2>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {SORTS.map((s) => (
              <button key={s.key} className={`chip ${sort === s.key ? "active" : ""}`} onClick={() => { setSort(s.key); setColSort(null); }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <SortTH col="name" colSort={colSort} onSort={setColSort} style={{ minWidth: 180 }}>Holding</SortTH>
                <SortTH col="class" colSort={colSort} onSort={setColSort}>Class</SortTH>
                <SortTH col="held" colSort={colSort} onSort={setColSort} num>Held</SortTH>
                <SortTH col="invested" colSort={colSort} onSort={setColSort} num>Invested</SortTH>
                <SortTH col="value" colSort={colSort} onSort={setColSort} num>Value</SortTH>
                <SortTH col="gain" colSort={colSort} onSort={setColSort} num>P&amp;L</SortTH>
                <SortTH col="gainPct" colSort={colSort} onSort={setColSort} num>%</SortTH>
              </tr>
            </thead>
            <tbody>
              {byAccount
                ? byAccount.map((grp) => (
                  <Fragment key={grp.a?.id ?? "?"}>
                    <tr style={{ borderTop: "2px solid var(--line)", background: "var(--surface-2)" }}>
                      <td style={{ fontWeight: 750 }}>
                        {grp.a?.name ?? "Unknown account"}
                        <span className="muted" style={{ fontWeight: 400, fontSize: "0.78rem" }}> · {grp.rows.length} holding{grp.rows.length === 1 ? "" : "s"}</span>
                      </td>
                      <td /><td />
                      <td className="num" style={{ fontWeight: 650 }}>{fmtMoney(grp.invested)}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{fmtMoney(grp.value)}</td>
                      <td className="num" style={{ fontWeight: 700, color: signColor(grp.gain) }}>{signed(grp.gain)}</td>
                      <td className="num" style={{ color: signColor(grp.gain) }}>{grp.gainPct != null ? signedPct(grp.gainPct) : "—"}</td>
                    </tr>
                    {grp.rows.map((r) => <HoldingRow key={r.h.id} row={r} grouped />)}
                  </Fragment>
                ))
                : clubbedSorted.map((g) => <ClubbedRow key={g.key} g={g} />)}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: "0.74rem", marginTop: "0.6rem" }}>
          Only holdings with a real purchase cost are listed — nothing here is estimated.
          {unmeasured.count > 0 && <> {unmeasured.count} holding{unmeasured.count === 1 ? "" : "s"} without
          one {unmeasured.count === 1 ? "is" : "are"} left out; add costs in <strong>Manage → ✎</strong> to include them.</>}{" "}
          {currentProfile().region === "US" ? "Non-USD" : "USD"} positions convert at today's ₹{usdInr}/$ for both cost and value, so their P&amp;L is price
          movement only (no FX effect).
        </p>
      </div>
    </div>
  );
}
