// A hypothetical ~₹13.5 Cr Indian HNI, used by the "Load demo" button so anyone can see the
// app fully populated without entering data. Values are illustrative, not advice.
//
// The demo is deliberately COMPREHENSIVE — it exercises every feature a fresh user will see:
//   • every asset class incl. REIT/InvIT, structured notes, PE, private credit, PMS/AIF, crypto;
//   • real NSE tickers / AMFI scheme codes / US tickers so "Reconstruct net-worth history" and
//     "Refresh live prices" actually work on it (units are sized so a live refresh lands near
//     the authored values; a wrong/dead code just degrades to carried-flat — never an error);
//   • cost bases on most holdings (with realistic winners AND losers) but deliberately missing
//     on EPF/FD/insurance/property/PMS — so the Performance tab shows both true P&L and the
//     ≈ since-import fallback;
//   • recent buys (STCG territory), an SGB held by grams, USD accounts, an EXCLUDED account
//     (Manage → include/exclude), liabilities, notes, and varied income kinds.

import { CURRENT_VERSION, type Account, type FlowEvent, type Holding, type Income, type Portfolio } from "./domain/types";
import { snapshotOf, todayLocal } from "./domain/snapshots";
import type { DailySnapshot } from "./domain/types";

let n = 0;
const id = () => `demo-${++n}`;

// Local YYYY-MM-DD for `daysAgo` days back (same day-keying the store uses).
const dayStr = (daysAgo: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return todayLocal(d);
};

interface AcctSpec extends Omit<Account, "id"> {
  items?: [name: string, cls: Holding["assetClass"], value: number, opts?: Partial<Holding>][];
}

// ---- 18 months of recorded history, synthesized ------------------------------
// The charts should DEMO well across every period chip: ~18 months of believable daily
// movement ending at exactly today's authored values, with accounts JOINING the record
// along the way (PMS funded a year ago, Schwab nine months back, crypto later, a plot and
// a new MF folio just weeks ago). Every entry has a matching flows-ledger event, so each
// step in the stack is classified and the growth/added/tracking split sums to the rupee.

export const DEMO_HISTORY_DAYS = 550;
export const DEMO_MF_DAYS_AGO = 20; // Groww folio — new money (`flow`)
export const DEMO_PLOT_DAYS_AGO = 15; // Alibaug plot — started tracking (`tracking`)

// When each late-joining account enters the record (everything else is there from day one).
export const DEMO_ENTERS: Record<string, { daysAgo: number; kind: FlowEvent["kind"]; label: string }> = {
  "Morgan Stanley (RSU/ESPP)": { daysAgo: 420, kind: "tracking", label: "Started tracking RSU/ESPP account" },
  "Marcellus PMS": { daysAgo: 365, kind: "flow", label: "Funded the PMS mandate" },
  "Schwab Brokerage": { daysAgo: 300, kind: "tracking", label: "Started tracking Schwab brokerage" },
  "NPS Tier-1": { daysAgo: 270, kind: "tracking", label: "Started tracking NPS" },
  "Edelweiss AIF": { daysAgo: 240, kind: "flow", label: "AIF capital call" },
  "Private Markets": { daysAgo: 200, kind: "flow", label: "PE & private-credit commitments" },
  "Crypto Wallet": { daysAgo: 150, kind: "tracking", label: "Started tracking the crypto wallet" },
  "Groww Mutual Funds": { daysAgo: DEMO_MF_DAYS_AGO, kind: "flow", label: "Opened Groww folio with new savings" },
  "Plot — Alibaug": { daysAgo: DEMO_PLOT_DAYS_AGO, kind: "tracking", label: "Started tracking — plot, Alibaug" },
};

// Deterministic PRNG (mulberry32) — the demo must be identical on every load so tests and
// screenshots are stable; the seed is arbitrary but fixed.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Daily-movement profile per account, keyed by demo account NAME (everything else is flat:
// EPF/FDs/insurance/property statements don't tick daily — exactly the user's ask).
// vol = daily σ, drift = expected ANNUAL move (converted to per-trading-day in the walk).
const MOVERS: Record<string, { vol: number; drift: number; weekends?: boolean }> = {
  "Zerodha Demat": { vol: 0.009, drift: 0.13 },
  "Equity Mutual Funds": { vol: 0.007, drift: 0.12 },
  "Groww Mutual Funds": { vol: 0.007, drift: 0.12 },
  "Debt Funds": { vol: 0.0006, drift: 0.067 },
  "NPS Tier-1": { vol: 0.004, drift: 0.095 },
  "Gold": { vol: 0.005, drift: 0.1, weekends: true },
  "Morgan Stanley (RSU/ESPP)": { vol: 0.011, drift: 0.11 },
  "Schwab Brokerage": { vol: 0.002, drift: 0.05 },
  "Crypto Wallet": { vol: 0.025, drift: 0.35, weekends: true },
  "HUF Demat": { vol: 0.009, drift: 0.12 },
};

const isWeekend = (date: string): boolean => {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(y, m - 1, d, 12).getDay();
  return dow === 0 || dow === 6;
};

// Walk each account's value BACKWARD from today's exact figure, so day 0 always equals the
// authored portfolio. Returns snapshots (ascending) + the two flow events, mutually consistent.
function synthesizeHistory(accounts: Account[], todayByAccount: Record<string, number>):
  { snapshots: DailySnapshot[]; flows: FlowEvent[] } {
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  const firstDayFor = (name: string): number => DEMO_ENTERS[name]?.daysAgo ?? DEMO_HISTORY_DAYS;

  // Per-account daily values, walked back from today. valuesByAccount[id][daysAgo].
  const valuesByAccount = new Map<string, Map<number, number>>();
  for (const [aid, todayValue] of Object.entries(todayByAccount)) {
    const name = nameById.get(aid) ?? "";
    const mover = MOVERS[name];
    const rand = rng(1991 + [...name].reduce((s, c) => s + c.charCodeAt(0), 0));
    const series = new Map<number, number>();
    let v = todayValue;
    series.set(0, Math.round(v));
    for (let daysAgo = 1; daysAgo <= firstDayFor(name); daysAgo++) {
      if (mover) {
        const tradingDay = mover.weekends || !isWeekend(dayStr(daysAgo - 1));
        if (tradingDay) {
          const noise = (rand() + rand() - 1) * mover.vol; // ~triangular, mean 0
          const r = mover.drift / (mover.weekends ? 365 : 252) + noise; // annual → per moving day
          v = v / (1 + r);
        }
      }
      series.set(daysAgo, Math.round(v));
    }
    valuesByAccount.set(aid, series);
  }

  const snapshots: DailySnapshot[] = [];
  for (let daysAgo = DEMO_HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
    const day: DailySnapshot = { date: dayStr(daysAgo), accounts: {} };
    for (const [aid, series] of valuesByAccount) {
      const name = nameById.get(aid) ?? "";
      if (daysAgo > firstDayFor(name)) continue; // account didn't exist in the record yet
      day.accounts[aid] = series.get(daysAgo)!;
    }
    snapshots.push(day);
  }

  // One ledger event per late-joining account, valued at its entry-day level — the step in
  // the recorded curve and the flows entry agree to the rupee by construction.
  const flows: FlowEvent[] = accounts
    .filter((a) => DEMO_ENTERS[a.name])
    .map((a) => {
      const e = DEMO_ENTERS[a.name];
      return {
        id: id(), date: dayStr(e.daysAgo), accountId: a.id,
        amount: valuesByAccount.get(a.id)!.get(e.daysAgo)!,
        kind: e.kind, source: "account_added" as const, label: e.label,
      };
    });

  return { snapshots, flows };
}

function build(specs: AcctSpec[]): { accounts: Account[]; holdings: Holding[] } {
  const accounts: Account[] = [];
  const holdings: Holding[] = [];
  for (const { items, ...acct } of specs) {
    const aId = id();
    accounts.push({ ...acct, id: aId });
    for (const [name, assetClass, marketValue, opts] of items ?? []) {
      holdings.push({
        id: id(), accountId: aId, name, assetClass, marketValue,
        currency: acct.currency, ...opts,
      });
    }
  }
  return { accounts, holdings };
}

export function demoPortfolio(): Portfolio {
  n = 0;
  const { accounts, holdings } = build([
    {
      name: "Zerodha Demat", institution: "Zerodha", accountType: "demat",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      items: [
        ["Reliance Industries", "indian_equity", 3_500_000, { symbol: "RELIANCE", units: 2770, costBasis: 2_100_000, buyDate: "2019-07-12" }],
        ["HDFC Bank", "indian_equity", 2_800_000, { symbol: "HDFCBANK", units: 3790, costBasis: 1_700_000, buyDate: "2020-03-20" }],
        ["Infosys", "indian_equity", 2_200_000, { symbol: "INFY", units: 1850, costBasis: 900_000, buyDate: "2018-11-05" }],
        ["TCS", "indian_equity", 1_800_000, { symbol: "TCS", units: 835, costBasis: 1_200_000, buyDate: "2021-01-18" }],
        ["ICICI Bank", "indian_equity", 1_600_000, { symbol: "ICICIBANK", units: 1280, costBasis: 750_000, buyDate: "2020-09-10" }],
        ["Bajaj Finance", "indian_equity", 1_500_000, { symbol: "BAJFINANCE", units: 1720, costBasis: 1_100_000, buyDate: "2022-06-01" }],
        ["Embassy Office Parks REIT", "reit_invit", 1_400_000, { symbol: "EMBASSY", units: 3290, costBasis: 1_100_000, buyDate: "2021-10-05" }],
        ["Larsen & Toubro", "indian_equity", 1_200_000, { symbol: "LT", units: 310, costBasis: 650_000, buyDate: "2021-08-22" }],
        // A realistic loser: bought near the top.
        ["Asian Paints", "indian_equity", 1_000_000, { symbol: "ASIANPAINT", units: 376, costBasis: 1_150_000, buyDate: "2023-01-09" }],
        ["Titan Company", "indian_equity", 900_000, { symbol: "TITAN", units: 215, costBasis: 400_000, buyDate: "2020-05-15" }],
        // Recent buy → STCG territory, small loss so the Performance tab shows red too.
        ["Trent", "indian_equity", 600_000, { symbol: "TRENT", units: 220, costBasis: 660_000, buyDate: "2025-11-20" }],
      ],
    },
    {
      name: "Equity Mutual Funds", institution: "CAMS / KFintech", accountType: "mutual_fund",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      // symbol = AMFI scheme code → mfapi.in NAV history powers the trend chart.
      items: [
        ["Parag Parikh Flexi Cap Fund", "equity_mf", 5_500_000, { symbol: "122639", costBasis: 3_000_000, buyDate: "2019-04-01" }],
        ["Mirae Asset Large Cap Fund", "equity_mf", 4_500_000, { symbol: "118825", costBasis: 2_400_000, buyDate: "2018-02-10" }],
        ["Axis Midcap Fund", "equity_mf", 3_000_000, { symbol: "120505", costBasis: 1_900_000, buyDate: "2021-03-15" }],
        // Re-entered recently → short-term; goes long-term in a month.
        ["SBI Small Cap Fund", "equity_mf", 2_500_000, { symbol: "125497", costBasis: 2_350_000, buyDate: "2025-07-01" }],
        ["HDFC Index Fund — Nifty 50", "index_etf", 3_500_000, { symbol: "119063", costBasis: 2_200_000, buyDate: "2020-01-08" }],
        ["UTI Nifty Next 50 Index Fund", "index_etf", 1_500_000, { symbol: "143341", costBasis: 1_050_000, buyDate: "2021-11-11" }],
        ["Axis Long Term Equity (ELSS)", "elss", 1_800_000, { symbol: "120503", costBasis: 1_100_000, buyDate: "2020-02-20" }],
      ],
    },
    {
      name: "Debt Funds", institution: "ICICI / HDFC MF", accountType: "mutual_fund",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      items: [
        ["HDFC Corporate Bond Fund", "debt_mf", 4_000_000, { symbol: "118987", costBasis: 3_500_000, buyDate: "2023-06-01" }],
        ["ICICI Prudential Liquid Fund", "debt_mf", 2_500_000, { symbol: "120197", costBasis: 2_350_000, buyDate: "2024-01-10" }],
      ],
    },
    {
      // PMS statements show value but rarely contributed capital — so NO cost basis here:
      // this is what the ≈ since-import fallback looks like on a big holding.
      name: "Marcellus PMS", institution: "Marcellus", accountType: "pms_aif",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-03-31",
      defaultAssetClass: "indian_equity", note: "Quarterly statement; cost basis not reported",
      items: [["Consistent Compounders Portfolio", "indian_equity", 8_500_000, { buyDate: "2021-04-01" }]],
    },
    {
      name: "Edelweiss AIF", institution: "Edelweiss", accountType: "pms_aif",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-03-31",
      defaultAssetClass: "pms",
      items: [["Edelweiss Alternative Yield Fund (Cat-II AIF)", "pms", 5_000_000, { costBasis: 4_500_000, buyDate: "2023-02-15" }]],
    },
    {
      name: "Private Markets", institution: "Avendus", accountType: "pms_aif",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-03-31",
      items: [
        ["Avendus Future Leaders Fund II (PE)", "private_equity", 3_500_000, { costBasis: 2_500_000, buyDate: "2022-01-15" }],
        ["Vivriti Samarth Bond Fund (private credit)", "private_credit", 2_500_000, { costBasis: 2_400_000, buyDate: "2024-03-01" }],
      ],
    },
    {
      name: "NPS Tier-1", institution: "HDFC Pension", accountType: "nps",
      taxTreatment: "nps", region: "India", currency: "INR", asOf: "2026-04-30",
      items: [["NPS — 75% equity / 25% debt", "nps", 2_200_000]],
    },
    {
      name: "Provident Fund", institution: "EPFO / SBI", accountType: "epf_ppf",
      taxTreatment: "eee_exempt", region: "India", currency: "INR", asOf: "2026-03-31",
      items: [
        ["EPF + VPF balance", "epf_ppf", 4_500_000],
        ["PPF account", "epf_ppf", 2_800_000],
      ],
    },
    {
      name: "Bank & Deposits", institution: "HDFC Bank", accountType: "bank",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      items: [
        ["HDFC Fixed Deposit", "fd_rd", 4_000_000],
        ["Savings account", "cash", 1_500_000],
      ],
    },
    {
      name: "Gold", institution: "RBI / Nippon", accountType: "demat",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      items: [
        // SGB held by weight: units = grams (250g @ ~₹4,800 issue price) → live ₹/g revalues it.
        ["Sovereign Gold Bonds (2021-22)", "gold_sgb", 2_000_000, { units: 250, costBasis: 1_200_000, buyDate: "2021-08-01" }],
        ["Nippon Gold ETF", "gold_other", 1_200_000, { costBasis: 700_000, buyDate: "2022-09-01" }],
      ],
    },
    {
      name: "LIC Endowment Policy", institution: "LIC", accountType: "other",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-03-31",
      defaultAssetClass: "insurance",
      items: [["LIC Jeevan Anand (fund value)", "insurance", 1_800_000]],
    },
    {
      name: "Morgan Stanley (RSU/ESPP)", institution: "Morgan Stanley", accountType: "foreign_broker",
      taxTreatment: "taxable", region: "US", currency: "USD", asOf: "2026-05-31",
      items: [
        ["Microsoft Corp (RSU)", "us_equity", 60_000, { symbol: "MSFT", units: 149, costBasis: 38_000, buyDate: "2022-02-15" }],
        ["Microsoft Corp (ESPP)", "us_equity", 25_000, { symbol: "MSFT", units: 62, costBasis: 26_500, buyDate: "2025-09-01" }],
      ],
    },
    {
      name: "Schwab Brokerage", institution: "Charles Schwab", accountType: "foreign_broker",
      taxTreatment: "taxable", region: "US", currency: "USD", asOf: "2026-05-31",
      items: [
        ["GOLDMAN SACHS FIN VAR 28 DUE 06/15/28 (autocallable)", "structured_notes", 40_000, { costBasis: 40_000, buyDate: "2024-06-15" }],
        ["US Treasury Notes 4.25% 2027", "fd_rd", 25_000, { costBasis: 24_500, buyDate: "2024-08-01" }],
        ["Schwab Value Advantage Money Fund", "cash", 8_000, { symbol: "SWVXX" }],
      ],
    },
    {
      name: "Crypto Wallet", institution: "Self-custody", accountType: "other",
      taxTreatment: "taxable", region: "Other", currency: "USD", asOf: "2026-05-31",
      items: [["Bitcoin", "crypto", 20_000, { symbol: "BTC", units: 0.32, costBasis: 9_000, buyDate: "2020-12-01" }]],
    },
    {
      // Pre-excluded: shows the Manage-tab include/exclude feature (kept on file, out of
      // net worth / allocations / AI brief until re-included).
      name: "HUF Demat", institution: "Zerodha (HUF)", accountType: "demat",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      excluded: true, note: "Family HUF folio — tracked here, excluded from personal net worth",
      items: [
        ["Coal India", "indian_equity", 600_000, { symbol: "COALINDIA", units: 1290, costBasis: 400_000, buyDate: "2021-06-10" }],
        ["ITC", "indian_equity", 600_000, { symbol: "ITC", units: 2150, costBasis: 450_000, buyDate: "2020-12-01" }],
      ],
    },
    {
      name: "Real Estate", institution: "—", accountType: "real_estate",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-01-01",
      defaultAssetClass: "real_estate", note: "Indicative market values — update yearly",
      items: [
        ["Primary residence — Mumbai", "real_estate", 27_500_000],
        ["Rented flat — Pune", "real_estate", 11_000_000],
      ],
    },
    {
      // Added mid-month (15 days ago) as "started tracking an asset I already owned" —
      // shows as a step in the recorded trend and a `tracking` line in the growth split.
      name: "Plot — Alibaug", institution: "—", accountType: "real_estate",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: dayStr(DEMO_PLOT_DAYS_AGO),
      defaultAssetClass: "real_estate", note: "Added to tracking recently — indicative value",
      items: [["Residential plot — Alibaug", "real_estate", 5_800_000]],
    },
    {
      // Opened 20 days ago with NEW money (a `flow` event) — same fund family as the main
      // folio, a recent STCG-territory buy with a real cost basis.
      name: "Groww Mutual Funds", institution: "Groww", accountType: "mutual_fund",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: dayStr(0),
      items: [
        ["Parag Parikh Flexi Cap (Direct)", "equity_mf", 625_000, { symbol: "122639", costBasis: 600_000, buyDate: dayStr(DEMO_MF_DAYS_AGO) }],
      ],
    },
    {
      name: "Home Loan", institution: "HDFC Ltd", accountType: "liability",
      taxTreatment: "na", region: "India", currency: "INR", asOf: "2026-05-31",
      items: [["Mumbai home loan (outstanding)", "other", 6_500_000]],
    },
  ]);

  const income: Income[] = [
    { id: id(), source: "Salary (CTC)", kind: "salary", amount: 600_000, frequency: "monthly", currency: "INR" },
    { id: id(), source: "Rental income — Pune flat", kind: "rent", amount: 45_000, frequency: "monthly", currency: "INR" },
    { id: id(), source: "Consulting retainer", kind: "business", amount: 300_000, frequency: "annual", currency: "INR" },
    { id: id(), source: "Dividends", kind: "dividend", amount: 300_000, frequency: "annual", currency: "INR" },
    { id: id(), source: "FD & bond interest", kind: "interest", amount: 120_000, frequency: "annual", currency: "INR" },
  ];

  const settings: Portfolio["settings"] = {
    country: "India", baseCurrency: "INR", claudeMode: "relay",
    relayUrl: "https://sampatti-relay.sampatti.workers.dev", usdInr: 95, byoKeySet: false, analysisModel: "claude-sonnet-4-6",
  };

  // A month of recorded history, walked back from today's exact per-account values
  // (liabilities negative), with the two mid-month account events in the flows ledger.
  const todayByAccount = snapshotOf({
    version: CURRENT_VERSION, accounts, holdings, income, edits: [], snapshots: [], flows: [], settings,
    updatedAt: new Date().toISOString(),
  }).accounts;
  const { snapshots, flows } = synthesizeHistory(accounts, todayByAccount);

  return {
    version: CURRENT_VERSION,
    accounts,
    holdings,
    income,
    edits: [],
    snapshots,
    flows,
    settings,
    updatedAt: new Date().toISOString(),
  };
}
