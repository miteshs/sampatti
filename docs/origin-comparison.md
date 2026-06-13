# Sampatti vs Origin Financial — gap analysis & roadmap

_Reference doc · June 2026._ Competitive comparison against [Origin](https://useorigin.com/),
a popular all-in-one US personal-finance app, to find gaps and how to close them **without
giving up Sampatti's local-privacy, India-first model**.

## What Origin is
A cloud, subscription all-in-one US money app:
- **Account aggregation** — Plaid (13,000+ institutions) + Zillow (real estate) + Coinbase
  (crypto) → auto net worth & spending.
- **Budgeting / spend tracking** — transactions, subscriptions, money in/out.
- **Managed investing** — automated index portfolios, no AUM fee (MERs on ETFs apply).
- **Tax** — free state+federal filing via Column Tax, plus tax-scenario simulation.
- **AI advisor** — markets itself as the "first SEC-regulated AI financial advisor," grounded
  in your data; answers on portfolio/spending/goals.
- **Estate planning** — attorney-designed wills/trusts in-app.
- **Human CFPs**, couples/household, iOS + Android.
- **Pricing:** $12.99/mo or $99/yr; 7–30 day trial.
- Recognition: Forbes "Best Budgeting App," Fast Company innovative fintech 2025.

## Side-by-side
| Capability | Origin | Sampatti | Verdict |
|---|---|---|---|
| Account sync | Auto (Plaid, US) | Manual + file import, local | Gap *(by design)* |
| Net worth | Auto + **over time** | Daily-recorded history + per-account stack, growth-vs-flows split | **Closed** |
| Investment analysis | Portfolio view + AI | Deep: HHI/concentration/allocation/tax look-through | **Sampatti deeper** |
| Budgeting / spending | Core (txns, subscriptions) | None (income sources only) | Gap |
| Managed investing | Robo, no AUM | — | Non-goal *(not a broker)* |
| Tax | Filing (US) + scenarios | India tax **analysis** + LTCG/STCG split | Sampatti deeper for India; no filing |
| AI advisor | "SEC-regulated," your data | Claude SEBI/CFP persona, India-deep, **shows exact JSON sent** | Comparable; Sampatti more private + India |
| Estate / human CFP | Yes | — | Non-goal |
| Goals & retirement planning | Yes | AI mentions only | **Gap** |
| Couples / household | Add a partner | Single portfolio | Gap |
| Mobile | iOS + Android | macOS + Windows + web preview | Gap (mobile) |
| **Privacy** | Cloud + Plaid (full data on servers) | **100% local, nothing sold** | **Sampatti wins big** |
| **Geography** | US only ($/Zillow/Column Tax) | **India-first** (₹, SGB/NPS/PPF/PMS/AIF, gold by weight) | **Sampatti wins for India** |
| Cost | $99/yr | Free + your own Claude (~cents/analysis) | Sampatti wins |

## Where Sampatti already leads — lean into these
- **Privacy** — data stays on the device; only a compact brief goes to Claude, and you can
  preview the exact JSON. Origin holds your entire financial life (plus Plaid).
- **India depth** — SEBI/CFP analyst persona, India tax (LTCG/STCG, debt-fund slab, ELSS/80C,
  NPS, SGB), ₹/lakh/crore, PMS/AIF, gold by weight. Origin is structurally US-only.
- **Transparency & cost** — deterministic on-device brief; free + your own Claude key.

> The closest *India* competitors (INDmoney, Kuvera, ET Money) aggregate via India's
> **Account Aggregator (AA)** framework — the consent-based, RBI-regulated answer to Plaid.
> That's the India-native path to "aggregation" if we ever want it.

## Gaps that matter — and how to close them (staying local + India)

### Tier 1 — close first (high value, feasible, on-brand)
1. ~~**Live price refresh**~~ — **DONE** (Yahoo/AMFI/mfapi via the native layer; FX auto-refreshes
   at launch).
2. ~~**Net worth over time**~~ — **DONE** (daily recorded snapshots, per-account stack, brush zoom,
   growth-vs-flows split).
3. **Goals + retirement projection** — corpus-vs-goals, SWP / safe-withdrawal, inflation,
   India return assumptions, NPS/PPF-aware — deterministic numbers + an AI narrative (the
   brief already does a retirement sense-check).
4. **Tax-action tools** — turn the LTCG/STCG split into actions: "harvest the ₹1.25L LTCG
   exemption," "you're ₹X / N days from long-term on holding Y."
5. **Portfolio-health score** — roll the existing per-number verdicts (`src/domain/verdicts.ts`)
   into one headline 0–100 read with friendly bands (see the Financial Fitness comparison
   below). Highest value / lowest effort, and on-brand for the 45–65 audience.

### Tier 2 — valuable, more effort
- Couples / household profiles (his / hers / joint).
- Spending / cash-flow from bank-statement CSV import (budgeting-lite).
- ~~Mobile~~ — **DONE (2026-06-13):** iOS (iPhone + iPad) shipped via the Tauri 2 iOS target on
  the same codebase — responsive bottom-tab UI + on-device privacy (sandbox, Data Protection,
  iCloud-backup exclusion). Android still open; a PWA was explicitly rejected (WebKit evicts
  script-writable storage — unsafe as the sole copy of financial data). Also shipped: **optional
  dark mode**.
- **India-benchmark KPI scorecard** — equity-by-age, concentration, liquidity-months, retirement-
  corpus adequacy, each scored vs. an age-cohort target (from the Financial Fitness comparison).
- **"Now / Next / Later" action plan** + a deterministic **SWOT** grid — make the AI review legible
  and actionable for people who won't read paragraphs (the UI frame for #3 + #4 above).
- Proactive nudges — rebalance, concentration, tax-deadline, SIP reminders.

### Tier 3 — strategic, heavy
- **India Account Aggregator** integration — consent-based, privacy-respecting aggregation
  (requires registering as / using an FIU + TSP). The privacy-aligned answer to Plaid.
- ~~MF Central / CAS import~~ — **DONE** (CAMS/KFintech + NSDL/CDSL CAS parsed fully on-device, password handling included, with cross-account duplicate reconciliation). Remaining: MF Central API-style auto-fetch.

## A second yardstick — the Financial Fitness Assessment

Compared against [Dhingra Consultants' Financial Fitness Assessment](https://financial-fitness-assessment.netlify.app/),
a questionnaire-driven scoring tool (also local-first — raw data stays in the browser). Different
shape from Sampatti (it scores a self-reported profile; we aggregate actual holdings), but four of
its ideas fit our "plain-words verdicts for non-techies" grain and are now on the roadmap above:

1. **Single health score (0–100) + friendly bands** ("Athlete / In training / Warm-up"). → Tier 1 #5.
2. **Age-banded KPI scorecard** vs. peer targets. → Tier 2.
3. **"Now / Next / Later" execution plan** with dated milestones. → Tier 2 (frames goals + tax actions).
4. **Deterministic SWOT** generated from the numbers. → Tier 2.

**Tension to decide, not just adopt:** its strongest KPIs (emergency-fund months, savings rate,
debt-to-income, 10× income life cover) need **monthly expenses + insurance coverage** — data
Sampatti deliberately does *not* collect (budgeting / spend-tracking are non-goals below). So a
fitness scorecard is either limited to **portfolio-only KPIs** (concentration, liquidity,
equity-by-age, corpus adequacy) or it crosses the expense-capture line — a real product decision,
not a default. **Don't borrow:** its cloud sync of "anonymised results" (our local-only stance is
stronger) or the consultation lead-gen funnel (we're not an advisory).

## Deliberate non-goals (and why)
| Origin feature | Why we don't match it |
|---|---|
| Plaid-style bank aggregation | Conflicts with local-privacy; India's path is AA, not Plaid |
| Managed/robo investing | We're not a broker (regulatory) |
| Tax **filing** | We do tax *analysis*, not ITR preparation |
| Estate documents (wills/trusts) | Not a law firm |
| Human-CFP marketplace | Not an advisory; the AI persona + disclaimer is the lane |

Matching these would dilute the privacy + India edge that differentiates Sampatti.

## Recommendation
Start with **#1 live price refresh + #2 net-worth-over-time** together — they remove the
stale-data weakness and deliver Origin's signature net-worth trend, both 100% local and
India-native (AMFI NAV). Then **#3 goals/retirement**, where the AI advantage compounds.

## Sources
- https://useorigin.com/
- https://thecollegeinvestor.com/53263/origin-app-review/
- https://robberger.com/origin-review/
- https://finance.yahoo.com/news/origin-unveils-first-ai-financial-140000884.html
