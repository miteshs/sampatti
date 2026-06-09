// A hypothetical ~₹12 Cr Indian HNI, used by the "Load demo" button so anyone can see the
// app fully populated without entering data. Values are illustrative, not advice.

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
        ["Reliance Industries", "indian_equity", 3_500_000, { units: 1180, buyDate: "2019-07-12" }],
        ["HDFC Bank", "indian_equity", 2_800_000, { units: 1650, buyDate: "2020-03-20" }],
        ["Infosys", "indian_equity", 2_200_000, { units: 1400, buyDate: "2018-11-05" }],
        ["TCS", "indian_equity", 1_800_000, { units: 470, buyDate: "2021-01-18" }],
        ["ICICI Bank", "indian_equity", 1_600_000, { units: 1300, buyDate: "2020-09-10" }],
        ["Bajaj Finance", "indian_equity", 1_500_000, { units: 200, buyDate: "2022-06-01" }],
        ["Larsen & Toubro", "indian_equity", 1_200_000, { units: 330, buyDate: "2021-08-22" }],
        ["Asian Paints", "indian_equity", 1_000_000, { units: 350, buyDate: "2019-12-02" }],
        ["Titan Company", "indian_equity", 900_000, { units: 250, buyDate: "2020-05-15" }],
        ["Zomato", "indian_equity", 600_000, { units: 2200, buyDate: "2025-11-20" }],
      ],
    },
    {
      name: "Equity Mutual Funds", institution: "CAMS / KFintech", accountType: "mutual_fund",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      items: [
        ["Parag Parikh Flexi Cap Fund", "equity_mf", 5_500_000, { buyDate: "2019-04-01" }],
        ["Mirae Asset Large Cap Fund", "equity_mf", 4_500_000, { buyDate: "2018-02-10" }],
        ["Axis Midcap Fund", "equity_mf", 3_000_000, { buyDate: "2021-03-15" }],
        ["SBI Small Cap Fund", "equity_mf", 2_500_000, { buyDate: "2022-07-01" }],
        ["HDFC Index Fund — Nifty 50", "index_etf", 3_500_000, { buyDate: "2020-01-08" }],
        ["UTI Nifty Next 50 Index Fund", "index_etf", 1_500_000, { buyDate: "2021-11-11" }],
        ["Axis Long Term Equity (ELSS)", "elss", 1_800_000, { buyDate: "2020-02-20" }],
      ],
    },
    {
      name: "Debt Funds", institution: "ICICI / HDFC MF", accountType: "mutual_fund",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-05-31",
      items: [
        ["HDFC Corporate Bond Fund", "debt_mf", 4_000_000, { buyDate: "2023-06-01" }],
        ["ICICI Prudential Liquid Fund", "debt_mf", 2_500_000, { buyDate: "2024-01-10" }],
      ],
    },
    {
      name: "Marcellus PMS", institution: "Marcellus", accountType: "pms_aif",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-03-31",
      defaultAssetClass: "indian_equity",
      items: [["Consistent Compounders Portfolio", "indian_equity", 8_500_000, { buyDate: "2021-04-01" }]],
    },
    {
      name: "Edelweiss AIF", institution: "Edelweiss", accountType: "pms_aif",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-03-31",
      defaultAssetClass: "other",
      items: [["Edelweiss Alternative Yield Fund (Cat-II AIF)", "other", 5_000_000]],
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
        ["Sovereign Gold Bonds (2021-22)", "gold_sgb", 2_000_000, { buyDate: "2021-08-01" }],
        ["Nippon Gold ETF", "gold_other", 1_200_000, { buyDate: "2022-09-01" }],
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
        ["Microsoft Corp (RSU)", "us_equity", 60_000, { units: 130, buyDate: "2022-02-15", currency: "USD" }],
        ["Microsoft Corp (ESPP)", "us_equity", 25_000, { units: 54, buyDate: "2025-09-01", currency: "USD" }],
      ],
    },
    {
      name: "Real Estate", institution: "—", accountType: "real_estate",
      taxTreatment: "taxable", region: "India", currency: "INR", asOf: "2026-01-01",
      defaultAssetClass: "real_estate",
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
    { id: id(), source: "Dividends", kind: "dividend", amount: 300_000, frequency: "annual", currency: "INR" },
  ];

  return {
    version: CURRENT_VERSION,
    accounts,
    holdings,
    income,
    settings: {
      country: "India", baseCurrency: "INR", claudeMode: "relay",
      relayUrl: "https://sampatti-relay.example.workers.dev", usdInr: 83, byoKeySet: false,
    },
    updatedAt: new Date().toISOString(),
  };
}
