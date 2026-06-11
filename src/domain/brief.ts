// The Portfolio Brief — a compact, deterministic summary computed on-device from the
// holdings. It is what we send to Claude (NOT the raw holdings), so the AI is grounded in
// real numbers while the data sent stays minimal. Mirrors the computation philosophy of
// tally/backend/app/analysis.py, reframed for India (no US tax math here — Claude reasons
// about Indian tax from these facts).

import { ASSET_CLASS_LABEL, isLiquid } from "./classify";
import { holdingBase, holdingGain, pct } from "./format";
import { buildSegments } from "./group";
import type { Account, AssetClass, Holding, Portfolio } from "./types";

export interface BriefHolding {
  name: string;
  assetClass: string;
  value: number;
  pctOfAssets: number;
  account: string;
  gainPct?: number; // unrealized %, only when a REAL cost basis is on file
}

export interface Brief {
  asOf: string;
  baseCurrency: string;
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
  liquidAssets: number;
  illiquidAssets: number;
  liquidPct: number;
  allocationByClass: { label: string; value: number; percent: number }[];
  allocationByRegion: { label: string; value: number; percent: number }[];
  allocationByTax: { label: string; value: number; percent: number }[];
  allocationByAccountType: { label: string; value: number; percent: number }[];
  concentration: {
    topHoldings: BriefHolding[];
    largestPctOfAssets: number;
    largestPctOfLiquid: number;
    top5PctOfLiquid: number;
    hhi: number; // Herfindahl index over individual equity names (0–10000)
  };
  holdingPeriods: {
    equityShortTerm: number; // equity-type taxable held < 1y (STCG territory)
    equityLongTerm: number; // equity-type taxable held >= 1y
    withBuyDate: number; // how much equity value actually had a buy date
  };
  taxWrappers: { taxable: number; exemptEEE: number; nps: number; usPretax: number; usRoth: number; usHsa: number };
  gains: {
    totalCostBasis: number; // INR; includes since-import anchors
    unrealizedGain: number;
    unrealizedPct: number; // gain / basis
    realBasisPct: number; // % of asset VALUE with a real (statement/user) purchase cost
  };
  income: { annualTotal: number; byKind: Record<string, number>; netWorthYears: number | null };
  staleness: { freshAccounts: number; agingAccounts: number; staleAccounts: number };
  notes: string[];
}

const EQUITY_CLASSES = new Set<AssetClass>([
  "indian_equity", "equity_mf", "index_etf", "elss", "us_equity",
]);

const daysBetween = (a: string, b: string) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

function alloc(holdings: Holding[], accounts: Account[], by: Parameters<typeof buildSegments>[2], usdInr: number) {
  const { segments } = buildSegments(holdings, accounts, by, usdInr);
  return segments.map((s) => ({ label: s.label, value: Math.round(s.value), percent: s.percent }));
}

export function buildBrief(p: Portfolio): Brief {
  const { usdInr, baseCurrency } = p.settings;
  const acctById = new Map(p.accounts.map((a) => [a.id, a]));
  const today = new Date().toISOString().slice(0, 10);

  let totalAssets = 0;
  let totalLiabilities = 0;
  let liquid = 0;
  const byName = new Map<string, number>(); // individual equity names → value (for HHI/top)
  const topRows: BriefHolding[] = [];
  let eqShort = 0, eqLong = 0, eqWithDate = 0;
  const wrappers = { taxable: 0, exemptEEE: 0, nps: 0, usPretax: 0, usRoth: 0, usHsa: 0 };
  let basisTotal = 0, gainTotal = 0, realBasisValue = 0;

  for (const h of p.holdings) {
    const a = acctById.get(h.accountId);
    const v = holdingBase(h, usdInr);
    if (a?.accountType === "liability") {
      totalLiabilities += v;
      continue;
    }
    totalAssets += v;
    if (isLiquid(h.assetClass)) liquid += v;

    const g = holdingGain(h, usdInr);
    if (g) {
      basisTotal += g.invested;
      gainTotal += g.gain;
      if (!g.estimated) realBasisValue += v;
    }

    topRows.push({
      name: h.name, assetClass: ASSET_CLASS_LABEL[h.assetClass] ?? h.assetClass,
      value: Math.round(v), pctOfAssets: 0, account: a?.name ?? "—",
      ...(g && !g.estimated && g.gainPct != null ? { gainPct: g.gainPct } : {}),
    });

    if (h.assetClass === "indian_equity" || h.assetClass === "us_equity") {
      byName.set(h.name, (byName.get(h.name) ?? 0) + v);
    }
    if (EQUITY_CLASSES.has(h.assetClass) && a?.taxTreatment === "taxable") {
      if (h.buyDate) {
        eqWithDate += v;
        if (daysBetween(h.buyDate, today) >= 365) eqLong += v;
        else eqShort += v;
      }
    }
    const tax = a?.taxTreatment ?? "taxable";
    if (tax === "eee_exempt") wrappers.exemptEEE += v;
    else if (tax === "nps") wrappers.nps += v;
    else if (tax === "us_pretax") wrappers.usPretax += v;
    else if (tax === "us_roth") wrappers.usRoth += v;
    else if (tax === "us_hsa") wrappers.usHsa += v;
    else wrappers.taxable += v;
  }

  const netWorth = totalAssets - totalLiabilities;
  const assetsDenom = totalAssets || 1;
  const liquidDenom = liquid || 1;

  // Concentration over individual equity names.
  const names = [...byName.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const largest = names[0];
  const top5 = names.slice(0, 5).reduce((s, n) => s + n.value, 0);
  const hhi = names.reduce((s, n) => s + ((n.value / liquidDenom) * 100) ** 2, 0);

  topRows.forEach((r) => (r.pctOfAssets = pct(r.value, assetsDenom)));
  topRows.sort((a, b) => b.value - a.value);

  // Income vs net worth (a crude "years of net worth = X years of income" sense check).
  const byKind: Record<string, number> = {};
  let annualIncome = 0;
  for (const inc of p.income) {
    const annual = (inc.frequency === "monthly" ? 12 : 1) * holdingBase(
      { marketValue: inc.amount, currency: inc.currency } as Holding, usdInr,
    );
    byKind[inc.kind] = (byKind[inc.kind] ?? 0) + annual;
    annualIncome += annual;
  }

  // Staleness buckets by account as-of date (same thresholds as the freshness panel).
  let fresh = 0, aging = 0, stale = 0;
  for (const a of p.accounts) {
    if (a.accountType === "liability" || a.accountType === "income") continue;
    if (!a.asOf) { aging += 1; continue; }
    const d = daysBetween(a.asOf, today);
    if (d <= 35) fresh += 1; else if (d <= 120) aging += 1; else stale += 1;
  }

  const notes: string[] = [];
  if (baseCurrency === "USD") {
    if (p.holdings.some((h) => h.currency.toUpperCase() !== "USD")) {
      notes.push(`Non-USD holdings converted at ₹${usdInr}/$ (manual rate).`);
    }
  } else if (p.holdings.some((h) => h.currency.toUpperCase() === "USD")) {
    notes.push(`USD holdings converted at ₹${usdInr}/$ (manual rate).`);
  }
  if (eqWithDate === 0 && liquid > 0) {
    notes.push("No buy dates captured, so STCG/LTCG holding-period split is unavailable.");
  }
  const realBasisPct = pct(realBasisValue, assetsDenom);
  if (totalAssets > 0 && realBasisPct < 60) {
    notes.push(
      `Real purchase costs are on file for only ${realBasisPct}% of assets; the rest of the unrealized-gain figure measures change since first import, NOT true cost — do not base tax math on it.`,
    );
  }

  const brief: Brief = {
    asOf: today,
    baseCurrency,
    netWorth: Math.round(netWorth),
    totalAssets: Math.round(totalAssets),
    totalLiabilities: Math.round(totalLiabilities),
    liquidAssets: Math.round(liquid),
    illiquidAssets: Math.round(totalAssets - liquid),
    liquidPct: pct(liquid, assetsDenom),
    allocationByClass: alloc(p.holdings, p.accounts, "asset_class", usdInr),
    allocationByRegion: alloc(p.holdings, p.accounts, "region", usdInr),
    allocationByTax: alloc(p.holdings, p.accounts, "tax", usdInr),
    allocationByAccountType: alloc(p.holdings, p.accounts, "account_type", usdInr),
    concentration: {
      topHoldings: topRows.slice(0, 10),
      largestPctOfAssets: largest ? pct(largest.value, assetsDenom) : 0,
      largestPctOfLiquid: largest ? pct(largest.value, liquidDenom) : 0,
      top5PctOfLiquid: pct(top5, liquidDenom),
      hhi: Math.round(hhi),
    },
    holdingPeriods: {
      equityShortTerm: Math.round(eqShort),
      equityLongTerm: Math.round(eqLong),
      withBuyDate: Math.round(eqWithDate),
    },
    taxWrappers: {
      taxable: Math.round(wrappers.taxable),
      exemptEEE: Math.round(wrappers.exemptEEE),
      nps: Math.round(wrappers.nps),
      usPretax: Math.round(wrappers.usPretax),
      usRoth: Math.round(wrappers.usRoth),
      usHsa: Math.round(wrappers.usHsa),
    },
    gains: {
      totalCostBasis: Math.round(basisTotal),
      unrealizedGain: Math.round(gainTotal),
      unrealizedPct: basisTotal > 0 ? Math.round((gainTotal / basisTotal) * 1000) / 10 : 0,
      realBasisPct,
    },
    income: {
      annualTotal: Math.round(annualIncome),
      byKind,
      netWorthYears: annualIncome > 0 ? Math.round((netWorth / annualIncome) * 10) / 10 : null,
    },
    staleness: { freshAccounts: fresh, agingAccounts: aging, staleAccounts: stale },
    notes,
  };

  // The brief is OUTBOUND — the model must speak the user's currency (a $ persona reading
  // INR figures would mislead). All computation above stays in the internal INR unit
  // (docs/regions.md); for a USD base every monetary field converts here, once, at the
  // edge. Percentages, counts, HHI and years are unitless and pass through.
  return baseCurrency === "USD" ? briefInUsd(brief, usdInr || 1) : brief;
}

function briefInUsd(b: Brief, rate: number): Brief {
  const c = (v: number) => Math.round(v / rate);
  const alloc = (rows: Brief["allocationByClass"]) => rows.map((r) => ({ ...r, value: c(r.value) }));
  return {
    ...b,
    netWorth: c(b.netWorth),
    totalAssets: c(b.totalAssets),
    totalLiabilities: c(b.totalLiabilities),
    liquidAssets: c(b.liquidAssets),
    illiquidAssets: c(b.illiquidAssets),
    allocationByClass: alloc(b.allocationByClass),
    allocationByRegion: alloc(b.allocationByRegion),
    allocationByTax: alloc(b.allocationByTax),
    allocationByAccountType: alloc(b.allocationByAccountType),
    concentration: {
      ...b.concentration,
      topHoldings: b.concentration.topHoldings.map((h) => ({ ...h, value: c(h.value) })),
    },
    holdingPeriods: {
      equityShortTerm: c(b.holdingPeriods.equityShortTerm),
      equityLongTerm: c(b.holdingPeriods.equityLongTerm),
      withBuyDate: c(b.holdingPeriods.withBuyDate),
    },
    taxWrappers: {
      taxable: c(b.taxWrappers.taxable),
      exemptEEE: c(b.taxWrappers.exemptEEE),
      nps: c(b.taxWrappers.nps),
      usPretax: c(b.taxWrappers.usPretax),
      usRoth: c(b.taxWrappers.usRoth),
      usHsa: c(b.taxWrappers.usHsa),
    },
    gains: { ...b.gains, totalCostBasis: c(b.gains.totalCostBasis), unrealizedGain: c(b.gains.unrealizedGain) },
    income: {
      ...b.income,
      annualTotal: c(b.income.annualTotal),
      byKind: Object.fromEntries(Object.entries(b.income.byKind).map(([k, v]) => [k, c(v)])),
    },
  };
}
