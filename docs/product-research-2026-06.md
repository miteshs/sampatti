# Sampatti product research — competitive analysis & privacy-first roadmap

*June 2026. Lens: "if a top fintech financial analyst sat with each user, what would they
actually do for them?" — then: which of those things can software do **without the data
leaving the device**. Privacy stays the first principle throughout; every proposed feature
carries a privacy budget: **[local]** nothing leaves · **[symbols]** only tickers/ISINs
leave (already Sampatti's pattern for prices) · **[consent]** user-initiated, previewable
(the AI-brief pattern).*

---

## 1. The 2026 market map (US-weighted, as requested)

### Aggregation-first cloud dashboards (the mainstream)
| Product | Price | What they're known for | Privacy reality |
|---|---|---|---|
| **Empower** (ex-Personal Capital) | Free | Fee Analyzer, Investment Checkup, Monte Carlo Retirement Planner | Free because the dashboard is a lead funnel for 0.89% AUM advisory (≥$100k); Plaid-style credential aggregation |
| **Monarch Money** | $99.99/yr | Post-Mint leader; polished UX; household/partner shared dashboards | Cloud aggregation; budgeting-first, thin portfolio analytics |
| **Copilot Money** | ~$69–95/yr | Apple-native feel | Cloud aggregation; individual-only |
| **Kubera** | $250–$2,500/yr (moved upmarket) | "Track everything" — brokerage, crypto/DeFi, real estate, collectibles; beneficiary/dead-man's-switch | Cloud; HNW-priced; tracking-deep but analysis-thin |

### Planning-first tools (the "am I going to be OK?" category)
| Product | Price | What they're known for | Privacy reality |
|---|---|---|---|
| **Boldin** (ex-NewRetirement) | $144/yr | Deepest consumer retirement planner; **Feb 2026: AI Planner Assistant grounded in your plan data** | Cloud |
| **ProjectionLab** | $129/yr, $1,199 lifetime | 10k-run Monte Carlo w/ block bootstrap; estate tab, QCD/DAF, Sankey cash-flow | **Manual entry by design; browser-local storage option; doesn't monetize data** — the privacy-respecting planner |

### Privacy/local-first trackers (Sampatti's true peers)
| Product | Price | Strength | Weakness |
|---|---|---|---|
| **Portfolio Performance** | Free (desktop) | Fully local file, AES-256 option; serious TWR/IRR analytics | Dense, technical, dated UI; hobbyist energy; no AI, no plain-words layer |
| **Ghostfolio** | Free (self-hosted OSS, 8k★) | Own infrastructure, no third parties | Requires self-hosting skills; thin analytics |
| **Wealthfolio** | Free (OSS desktop) | Local-only, no subscription | Early; thin |
| **Capitally** | Paid | E2E encryption; 11-jurisdiction tax presets, 6 cost-basis methods, TLH tool | Web-based; no India depth; no AI |

### Analytics specialists (feature donors to study)
- **Sharesight** — automated dividend/corporate-action tracking + country tax reports (US/UK/AU/NZ/CA — *not* India).
- **Snowball Analytics** — dividend calendar + 12-month income forecast, target-allocation rebalancing suggestions, fund X-ray look-through.
- **Morningstar X-Ray** — the classic fund-overlap / true-exposure analysis.

### India (context, since Sampatti is India-first)
- **INDmoney** — super-app; Account Aggregator integration; monetizes by selling products; cloud data play.
- **MProfit** — the serious India tracker: CAS auto-import, capital gains/XIRR tax reports; strong with CAs/advisors.
- **Kuvera/ET Money/Zerodha Console** — free, captive or product-led.
- **Account Aggregator (Sahamati/RBI)** — the regulated consent rail; no credential sharing; data flows where the user directs it. Strategically important: it is the *only* aggregation mechanism compatible with Sampatti's principles.

### The two structural takeaways
1. **The mainstream monetizes the data or the AUM.** Empower's free dashboard funds an
   advisory funnel; Monarch/Copilot need Plaid-style credential sharing; Kubera holds
   everything server-side. Privacy is Sampatti's wedge, and the wedge is widening
   (Mint's death taught users that cloud finance apps die and take history with them).
2. **The privacy-first peers have no "analyst in the room."** Portfolio Performance,
   Ghostfolio, Wealthfolio: zero AI, zero plain-words verdicts, zero guidance — they're
   mirrors for tinkerers. Nobody in the privacy segment answers *"so what should I look
   at?"* That's exactly Sampatti's verdict + AI-brief architecture. And nobody anywhere
   serves the **India+US dual-market (NRI/returnee) family** with tax-aware depth.

---

## 2. What a top analyst does for a client — and the feature each maps to

A real analyst answers seven questions. Each is a module; each is computable locally.

### Q1. "Am I going to be OK?" → **The Planning Engine** ⭐ biggest gap
Goal-based projections + retirement/FIRE Monte Carlo (10k runs is table stakes — see
ProjectionLab), with **both regions done properly**:
- India: EPF/PPF/NPS accumulation & maturity rules, SSY, gratuity, rental yield, LTCG
  regimes per asset class, SWP modelling.
- US: 401k/IRA/Roth (+ backdoor/mega-backdoor), RMDs, Social Security estimate, ACA
  bridge years, Roth-conversion ladders.
- Scenario blocks: sabbatical, house purchase, education (India: foreign-education
  corpus is *the* anxiety), parental support, return-to-India / move-to-US transitions.
**[local]** — pure math on data already in the app. This single module converts Sampatti
from a mirror into an advisor and unlocks willingness-to-pay (Boldin $144, ProjectionLab
$129 — for planning *alone*, with manual entry).

### Q2. "What am I paying?" → **Fee X-Ray**
Empower's most famous hook, done privacy-first: expense ratios by ISIN/ticker (public
data: AMFI TERs, fund factsheets), advisory/PMS fees as inputs, compounding-drag
projection ("this fund costs you ₹18L by 2045"). **India killer variant: regular-vs-direct
plan detection** from the CAS — the single most quantifiable money-saver in Indian MF
investing, and the cloud apps that *could* do it won't, because distributors fund them.
**[symbols]** for TER lookups, math local.

### Q3. "Am I actually diversified?" → **Overlap / True-Exposure X-Ray**
Fund look-through using public constituent data: true sector/geo/factor exposure,
pairwise fund overlap, and the killer demo for the videos — *"your Infosys exposure is
11%, not 4%: 7% hides inside your funds, on top of your RSUs."* Connects to the existing
concentration verdict. **[symbols]** for constituents, compute local.

### Q4. "What does the taxman see?" → **Tax Lots & Harvesting**
Lot-level cost basis (FIFO/specific-lot/average per jurisdiction rules), ST/LT split,
then: India — LTCG ₹1.25L exemption harvesting, grandfathering, asset-class regimes; US —
wash-sale detection, TLH candidates, lot-aware sell planner. NRI/DTAA awareness as the
differentiator no one has. Capitally does 11 jurisdictions shallowly; Sampatti should do
**two jurisdictions deeply**. **[local]**, with AI explaining the *why* via the existing
previewable brief.

### Q5. "What does it pay me?" → **Income Engine**
Forward dividend/interest calendar and 12-month income forecast (Snowball's signature),
DRIP handling, FD/bond ladder maturities, SWP planning for the retired parent persona.
**[symbols]** for dividend schedules, math local.

### Q6. "What if X happens?" → **Stress Tests**
Replay 2008 / COVID-2020 / 2013 INR-taper on today's portfolio; shock USD/INR ±10%;
employer stock −50%; rate +2% on the home loan vs prepay-vs-invest analysis. Cheap to
build on existing data; emotionally resonant; pairs with verdicts. **[local]**

### Q7. "What about my family?" → **Household & Estate Readiness**
Multi-profile (spouse/parents) with combined and individual views; nominee/beneficiary
audit checklist per account (India's unclaimed-assets problem is folklore-level);
insurance adequacy (term cover vs human capital); **"In case I'm gone" encrypted dossier**
export — Kubera's beneficiary feature without Kubera's servers. **[local]**

---

## 3. Ingestion & trust (the moat-deepeners)

- **More parsers** (each one removes a manual-entry excuse): US — IBKR Flex, Robinhood,
  E*TRADE, Merrill, HSA custodians, 401k exports (Fidelity NetBenefits/Empower/Vanguard);
  India — Zerodha/Groww/Upstox holdings, NPS statement, EPF passbook PDF. **[local]**
- **OFX/QFX/QIF** — the US standard export every bank/brokerage offers. **[local]**
- **Fully-local statement OCR** via the on-device model already in development — removes
  today's "PDFs are read by Claude" caveat entirely; the import story becomes 100%
  on-device. **[local]** ⭐ strategic
- **Account Aggregator rail (India, later)** — regulated, consented, credential-free;
  the only aggregation compatible with the principles. **[consent]**
- **Encryption at rest + passphrase** (table stakes vs Portfolio Performance's AES file).
- **Device-to-device encrypted sync without cloud** (file/LAN based) — the #1 practical
  objection to local-first apps; solving it without servers is a durable moat. **[local]**
- **Network audit log in-app** — live view of every byte that left and why ("prices:
  3 ISINs to AMFI; AI: this brief, 412 tokens"). Cheap to build, devastating positioning
  vs the Plaid world; makes the privacy promise *inspectable* instead of asserted.
- **Monthly net-worth snapshots archive** — "statements about yourself"; also the data
  spine for the planning engine's actuals-vs-plan tracking.

### The AI flagship (nobody can follow)
Boldin's Feb-2026 AI assistant is grounded in your plan data — *in their cloud*. Sampatti
already has the two pieces no competitor has together: a previewable compact brief
(consented cloud AI) and an embedded local LLM in eval. Ship the local tier as
**"AI analysis with the network cable unplugged"** — grounded follow-ups, "explain this
holding/fee/verdict", and a yearly India+US tax-rules pack shipped *with app updates*
(rules arrive as data, not as queries). That sentence cannot be copied by anyone whose
business model is the data.

---

## 4. Positioning & monetization notes

- **ICP sharpening**: the unserved segment is the **dual-country household** (NRI in the
  US, returnee in India, cross-border families). INDmoney tries (cloud, sells products),
  Kubera does currencies (no tax depth), Sharesight skips India. Sampatti's region
  architecture + both tax engines = a category of one.
- **The privacy segment pays**: Kubera $250+, Boldin $144, ProjectionLab $129/yr or
  $1,199 lifetime, Monarch $99 — all without Sampatti's privacy story. A free tracker +
  paid **Analyst tier** (Planning, Fee X-Ray, Tax Lots, Estate dossier) at ~$79–129/yr or
  a one-time license is consistent with the desktop, no-data-monetization ethos.
  ProjectionLab's lifetime option resonates strongly with this exact audience.
- **Trust artifacts as marketing**: signed/notarized builds (already planned), the
  network audit log, `Built from <commit>` stamps, and reproducible-build notes are
  *features* for this segment — show them in the videos.

---

## 5. Prioritized roadmap (impact × privacy-fit × effort)

**Tier 1 — analyst quick wins (existing data, weeks):**
1. Fee X-Ray incl. regular-vs-direct detection **[symbols]**
2. XIRR + benchmark-vs-index (Nifty TRI / S&P 500 TR) + max-drawdown on the existing
   performance engine **[symbols]**
3. Forward income calendar (dividends/FD maturities) **[symbols]**
4. Stress-test scenarios on current holdings **[local]**

**Tier 2 — the big rocks (the category change):**
5. Planning Engine: goals + Monte Carlo retirement/FIRE, IN+US instruments **[local]** ⭐
6. Tax Lots & Harvesting (IN ₹1.25L LTCG + US wash-sale/TLH) **[local]**
7. Overlap/True-exposure X-Ray **[symbols]**

**Tier 3 — moat-deepeners:**
8. Local statement OCR (kills the last cloud caveat) **[local]**
9. Household profiles + estate dossier + nominee audit **[local]**
10. Encryption at rest; cloudless device sync; network audit log **[local]**
11. Parser breadth + OFX/QFX; Account Aggregator rail (India) **[consent]**
12. Local-LLM analyst tier as the flagship positioning **[local]** ⭐

**Explicit non-goals** (privacy-incompatible or off-mission): credential-based
aggregation (Plaid/Yodlee), bank-transaction budgeting as a pillar (Monarch/YNAB's turf;
cash-flow-lite via CSV import is enough), selling or recommending products
(INDmoney's model), any server-side storage of holdings.

---

*Sources consulted (June 2026): Empower tools & reviews (robberger.com, choosefi,
NerdWallet, empower.com), net-worth tracker roundups (knowyourdosh, wallethub,
wallstreetzen Kubera review), ProjectionLab/Boldin comparisons (bogleheads,
retirementplanningtools.net, projectionlab.com, boldin.com), privacy-first tracker
comparisons (mycapitally.com, openalternative.co, ghostfolio GitHub), analytics
specialists (snowball-analytics.com, mycapitally dividend/analysis comparisons),
India landscape (mprofit.in, indmoney.com, noveltywealth.in).*
