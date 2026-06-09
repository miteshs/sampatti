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

import { CURRENT_VERSION, type Account, type Holding, type Income, type Portfolio } from "./domain/types";

let n = 0;
const id = () => `demo-${++n}`;

interface AcctSpec extends Omit<Account, "id"> {
  items?: [name: string, cls: Holding["assetClass"], value: number, opts?: Partial<Holding>][];
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

  return {
    version: CURRENT_VERSION,
    accounts,
    holdings,
    income,
    edits: [],
    snapshots: [],
    flows: [],
    settings: {
      country: "India", baseCurrency: "INR", claudeMode: "relay",
      relayUrl: "https://sampatti-relay.sampatti.workers.dev", usdInr: 95, byoKeySet: false, analysisModel: "claude-sonnet-4-6",
    },
    updatedAt: new Date().toISOString(),
  };
}
