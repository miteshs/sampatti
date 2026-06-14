# Sampatti — Product Specification

> **What this document is.** A complete, implementation-agnostic specification of Sampatti:
> what it must do and why, the rules its behavior must obey, and how to tell when it is
> correct. It deliberately avoids naming languages, frameworks, file layouts, or libraries —
> those are the implementer's choices and live in [Appendix A](#appendix-a--reference-implementation).
> Hand the sections above Appendix A to a capable engineer (human or AI) and they should be
> able to build a faithful Sampatti without ever seeing the current code.
>
> **What counts as "implementation detail" vs. "requirement."** Technology and code structure
> are implementation. But some choices that *look* technical are actually product requirements
> because they define the product's promise — "raw financial data never leaves the device" is a
> requirement, not an implementation choice. This spec states such constraints explicitly and
> marks them **(MUST)**. Where a behavior is observable to the user or to a test, it belongs here.

---

## 1. Vision

A **private, India-first application — on the desktop (macOS, Windows) and on iOS (iPhone, iPad) —
that turns everything a person owns into one
clear picture of their wealth, then gives them an expert-grade review of it** — without their
financial data ever leaving their own computer.

It exists for the Indian household investor whose money is scattered across stocks, mutual
funds, EPF/PPF, NPS, FDs, gold, PMS/AIF, insurance, foreign RSUs, and property — instruments
no US-built personal-finance app understands — and who wants the judgment of a good financial
analyst without handing their entire financial life to a cloud service or paying an adviser.

The one-sentence test of the product: **"In five minutes I can see everything I own in one
place, and get a thoughtful, India-aware review of it, and I never had to trust anyone else
with my data."**

---

## 2. Goals and non-goals

### Goals
- Aggregate a complete net-worth picture across every asset class an Indian investor realistically holds.
- Make the *first run* fast: a person with their statements on hand should reach a full picture in minutes.
- Provide a genuinely expert, India-specific analysis of the portfolio — concentration, diversification, tax treatment, liquidity, retirement readiness — as an interactive conversation, not a static report.
- Keep all raw financial data on the user's own device. Only a small, inspectable summary may be sent for analysis, and only with the user's understanding.
- Work for a non-technical 45–65-year-old: plain language, no jargon, no accounts to create, no setup.
- Be trustworthy by construction: the user can see exactly what (if anything) leaves their machine, and can export or erase everything at any moment.

### Non-goals (explicitly out of scope)
- **Account aggregation / bank linking.** No screen-scraping or open-banking connections. Import is by file or manual entry. (India's regulated Account Aggregator framework is the only acceptable future path, and is not in scope here.)
- **Budgeting / spend tracking / transaction categorization.** The product tracks holdings and income sources, not day-to-day spending.
- **Managed investing / brokerage / order placement.** It is not a broker or robo-adviser.
- **Tax filing.** It *analyzes* tax exposure; it does not file returns.
- **Estate planning, will generation, human-adviser marketplace.**
- **Multi-user / household / couples portfolios.** One portfolio per installation.
- **Android.** The supported platforms are macOS, Windows, and **iOS — iPhone and iPad** (§11). Android is out of scope for now. (A browser build exists for development only; it is **not** a shipping target — see §11.3 for why a hosted PWA is not an acceptable substitute for the native mobile app.)
- **Being a regulated financial adviser.** The product is explicitly educational and says so.

---

## 3. Users

**Primary persona — "the self-directed Indian investor."** 40–65, financially literate but not
a professional, has accumulated 8–20 holdings across many institutions over decades. Comfortable
downloading statements; not comfortable writing code or trusting fintech startups with their
net worth. Values privacy and India-specific competence highly.

**Secondary persona — "the NRI / cross-border investor."** Holds both Indian instruments and
foreign (typically US) brokerage/retirement accounts in different currencies, and needs them in
one view with correct tax framing for each.

Design consequences that follow from the personas (all **MUST**):
- Default to plain language; never show an unexplained acronym or metric.
- Larger base type sizes and high-contrast text suitable for older eyes.
- Zero required setup: no sign-up, no onboarding wall, an instant demo available.
- The product must feel calm and editorial, not like a trading terminal.
- The same experience must work by **touch as a first-class input**, not just mouse — every interaction (chart zoom/inspect, edit, import) is reachable without hover, with touch-sized targets, and the layout is **responsive** across phone, tablet, and desktop widths and orientations (§10).

---

## 4. Principles and hard constraints

These are the load-bearing promises. Violating any of them is a defect, not a trade-off.

1. **Privacy by construction (MUST).** Raw holdings, account details, income, and source files
   never leave the device for storage or analysis. The only data permitted to leave the device
   are the three categories in §9, each under stated conditions. There is no user account, no
   sign-in, and no server-side database of user data. On any platform with an automatic cloud-backup
   channel for app data (notably **iOS iCloud backup**), the saved portfolio is **excluded from that
   channel by default** so the promise holds literally; user-initiated Export (§6.8) is the supported
   backup path, and the OS keystore item is marked non-syncable so a stored key never rides cloud
   keychain sync to another device (§10).
2. **Inspectable egress (MUST).** Anything sent off-device for analysis must be a compact,
   derived *summary* (the "Brief", §8.5) that the user can view in full before or at the time it
   is sent. No raw file and no per-holding identifying cost data is ever in it.
3. **India-first, not India-only (MUST).** The default experience assumes Indian instruments,
   ₹ formatting (lakh/crore), and Indian tax law. A US region exists as a *profile* over the
   same engine, never a fork. Internally, money is represented in a single base currency so a
   region switch never rewrites stored history.
4. **On-device by default, AI by choice.** The product is useful with no AI at all (import,
   dashboard, allocation, history all work offline). AI is an additive layer the user opts into.
5. **Determinism where it matters (MUST).** Everything the user sees as a number — net worth,
   allocations, P&L, the Brief — is computed deterministically on-device. The same inputs always
   produce the same numbers. AI is used for *narrative and extraction*, never to invent figures.
6. **Truthful uncertainty (MUST).** When a number is estimated or its basis is unknown, the
   product says so visibly and never lets that estimate masquerade as fact (especially for tax math).
7. **No lock-in.** One-click export of everything to an open format; one-click erase that truly deletes.
8. **Quality-gated.** No change ships without passing the full automated gate set (§12).

---

## 5. Domain model (conceptual)

The product persists exactly one **Portfolio** per installation. The model below is conceptual —
field names are illustrative, not prescriptive.

- **Portfolio** — the root. Contains accounts, holdings, income sources, settings, an edit log,
  a daily net-worth history, a classified-flows ledger, and a schema version. Self-contained and
  serializable to a single human-readable document.

- **Account** — a place money lives: a demat/broker account, a mutual-fund folio, NPS, EPF/PPF,
  a bank (savings/FD), a PMS/AIF, a foreign broker, real estate, an income source, or a liability
  (loan, subtracted from net worth). Carries an institution name, a tax treatment, a region, a
  currency, an optional statement-as-of date (drives staleness), and an **excluded** flag that
  keeps it on file but removes it from *every* computation.

- **Holding** — one position inside an account: a name, optional symbol (ticker/ISIN/scheme code),
  an **asset class** (from a fixed taxonomy covering ~21 instrument types an Indian investor holds),
  units, a market value in the holding's currency, an optional **cost basis** and **buy date**, and
  a flag marking whether the cost basis is *real* (from a statement/user) or *estimated* (set to the
  value at first import). The product also supports aggregate accounts entered as a single value
  (a flat, a PMS) tagged to one class with no per-holding detail.

- **Income** — a salary/rent/business/dividend/interest source with amount, frequency, currency.

- **Settings** — region/country, base currency, the AI-access mode (hosted relay vs. the user's
  own key), the relay endpoint, the FX rate used to convert foreign holdings to base, the chosen
  analysis model, optional free-text personal context for the analysis, per-task AI engine choice
  (hosted vs. on-device), and a developer-mode switch gating experimental features.

- **EditEvent** — an append-only log entry recording a manual edit (so user overrides are visible
  and they know a value won't match a fresh import). Logged for hand edits only, never for price
  refreshes, include/exclude, or imports.

- **DailySnapshot** — one day's recorded net worth, stored *per account* in base currency
  (liabilities negative). These are **real records of what the app computed that day**, not a
  re-derivable cache: they capture buys/sells/FX as they happened. The trend re-sums them over
  currently-visible accounts at render time, so excluding or deleting an account applies
  retroactively without leaving a cliff.

- **FlowEvent** — a classified money movement recorded whenever the app can explain *why* net
  worth changed: **flow** (real money in/out), **tracking** (started/stopped tracking an existing
  asset — not savings, not growth), or **unclassified** (a delta it couldn't attribute). Growth is
  **never stored**; it is always the residual (ΔNetWorth − flows − tracking − unclassified), so the
  parts sum to the whole by construction with a single source of truth.

**Key model invariants (MUST):**
- *Single base currency internally.* Foreign-currency holdings are converted to base for all
  storage and computation; conversion happens only at display and at the moment of building the
  outbound Brief. A region/display switch never rewrites stored snapshots or flows.
- *Estimated basis is set, flagged, and never trusted as a purchase price.* When no real cost is
  known, basis = value at first import and is flagged estimated; P&L then means "since first import,"
  and tax reasoning must exclude it.
- *Exclusion means exclude everywhere.* An excluded account vanishes from net worth, allocations,
  history, the Brief, and AI — but stays on file to be re-enabled.
- *Schema is versioned and forward-migrating.* Old saved portfolios load and migrate automatically.

---

## 6. Functional requirements

### 6.1 Onboarding
- First launch presents a single choice: **try a demo portfolio** or **bring in your own statements**. No account creation, no wall.
- A demo portfolio must exist that exercises *every* feature: all asset classes, winners and losers, estimated vs. real bases, excluded accounts, multiple income kinds, and a long synthetic history. It must be deterministic (same every time) and self-consistent (the history's start values reconcile to today's totals).
- The region is chosen up front ("where do you manage your money?") and changes formatting, tax language, and available instrument types.

### 6.2 Bringing in data
The product accepts data through several paths, in rough order of preference:

- **CAS PDFs parsed entirely on-device (MUST stay local).** The Indian consolidated account
  statements — the CAMS/KFintech mutual-fund CAS and the NSDL/CDSL depository CAS — are decrypted
  (password handled locally, never stored) and parsed on the device with no AI and no network.
  Multiple statement flavors must converge onto the same canonical accounts so the same fund seen
  in two statements is not duplicated.
- **Cross-account duplicate reconciliation.** When the same security appears in two imports (e.g. a
  CAS and a broker export), the product detects it (by identifier first, normalized name as
  fallback), warns the user about double-counting, and offers one-click removal of exact duplicates
  while keeping genuinely different positions.
- **CSV / spreadsheet, parsed on-device (MUST stay local).** Must handle messy real-world exports:
  multi-account sections in one sheet, multiple sheets, varied header names, and value-based
  currency detection. The product detects the grid/header shape itself rather than requiring a fixed format.
- **PDF / screenshot via AI extraction (only with explicit consent).** Documents that can't be
  parsed deterministically may, *only after the user confirms for that specific document*, be sent
  to the AI to extract holdings. The result is always shown as an **editable draft** for review
  before it is saved — nothing is committed silently.
- **Manual entry** for anything, including gold by weight (priced from a live ₹/gram rate) and
  income sources.

On touch/mobile platforms, file input uses the native document picker (Files / iCloud Drive / mail
attachment) and drag-and-drop where the OS supports it; export uses the native share sheet rather
than a desktop save dialog (§6.8). The parsing, draft-review, and reconciliation behavior is identical.

Rules for all import paths (MUST):
- Nothing is committed without the user seeing it as a reviewable, editable draft.
- Re-importing a statement *updates* the matching account rather than creating a duplicate
  (matched by institution + account name, normalized), with an "apply to which account" chooser
  when ambiguous.
- On re-import, real cost bases and buy dates are **carried forward** when a new statement omits
  them; estimated anchors may scale with units, real bases never silently change.
- Cost basis and buy date are optional everywhere but captured when available, because they unlock P&L and tax tooling.

### 6.3 Managing the portfolio
- Every imported value is editable after the fact (accounts and holdings).
- Accounts can be included/excluded (a labeled toggle) or removed (with a friendly confirmation).
- Manual edits are logged and surfaced, so the user knows which values they overrode and that those won't match a fresh import.
- A holding's provenance (imported vs. hand-edited vs. estimated) is visible.

### 6.4 Dashboard / Overview
- A hero net-worth figure with a day-over-day change, derived from recorded history.
- **Plain-language verdicts** on each headline number (equity exposure, liquidity, concentration) — a short, human read with a tone (good / okay / watch), never a bare metric.
- Allocation visualized as a small number of **lay-person buckets** (≈6), with the full instrument-level taxonomy available on demand (e.g. expanding a bucket).
- Allocation viewable by **type, account, tax treatment, region, and institution.**
- A net-worth-over-time chart from recorded history, with a split of **growth vs. money added vs. tracking changes.**
- All jargon is translated: "profit so far (on paper)," "purchase prices on file," "concentration score," "how it's taxed."

### 6.5 Performance
- The portfolio shown **stacked account-by-account over time**, from recorded history, extended back to the oldest purchase using real cost bases where available (clearly marking the pre-record, reconstructed era as lower-confidence).
- Time-window controls (e.g. 1M / 3M / YTD / 1Y / 2Y / 5Y / All) shared across charts, plus drag-to-zoom.
- A P&L table computed **strictly from real purchase costs** — estimated bases are excluded from P&L entirely, with a coverage indicator pointing the user to where to add the missing cost data.
- P&L views: top gainers, top losers, largest positions, and per-account subtotals. A "held-for" duration column as the seed of holding-period/tax tooling.

### 6.6 AI analysis (interactive)
- A **streamed** portfolio review written in the voice of a top India-aware financial analyst
  (SEBI/CFP-style persona for India; a fiduciary CFP/RIA persona for the US region). It covers
  concentration, diversification, India tax (equity LTCG/STCG, debt-fund slab taxation, ELSS/80C,
  NPS/80CCD(1B), SGB, harvesting), liquidity, and a retirement/income sense-check.
- A **follow-up chat** so the user can ask questions about their own portfolio, with suggested example questions to start.
- The analysis is grounded **only** in the deterministic Brief (§8.5) plus the user's optional free-text context. The model is instructed never to invent figures.
- The exact data sent (the Brief) is viewable by the user (transparency requirement, §9).
- The user can choose the model (framed as "most thorough / balanced / quickest," not raw model names) and can supply personal context (age, retirement year, risk appetite) that tailors the review.

### 6.7 Live data
- Optional refresh of live prices for holdings (equities, mutual funds, gold), sending only public identifiers — never holdings, amounts, or identity.
- Automatic refresh of the foreign-exchange rate used to convert foreign holdings to base currency, fetched on launch, requesting only the public rate.
- A manual FX override is available.

### 6.8 Privacy & data controls
- A dedicated screen that, in plain language, states what is stored, where (showing the real file path), and exactly what can leave the device and under what conditions.
- The screen adapts to the OS, naming the right keystore and at-rest protection: Keychain + FileVault (macOS), Credential Manager + BitLocker (Windows), and on **iOS** the app sandbox + always-on Data Protection encryption + Keychain/Secure Enclave (no user action required) — and on iOS it states whether the portfolio is excluded from iCloud backup (§10). The exact-file-path text is desktop-only; on iOS the data lives in the app sandbox and the screen says so rather than showing a browsable path.
- A visible warning whenever the user has pointed the app at a non-default analysis endpoint.
- **Export everything** to a single open-format file.
- **Erase all data** — an immediate, true deletion of the local file.
- **Switch the AI path** between hosted relay and the user's own key.

### 6.9 Settings & regions
- A single settings surface owns *all* configuration: AI engine choice, AI path (relay/own key), model, region/country, FX, and the developer-mode switch. The privacy screen is for transparency and export/erase only.
- Region is a profile (currency formatting, tax vocabulary, adviser persona, which instrument types are offered, whether gold-by-weight and CAS-specific affordances appear) — applied over one shared engine, never a code fork. Switching region must not corrupt or rewrite stored history.

### 6.10 On-device AI (optional, experimental tier)
- The user may route either AI task — statement extraction and/or the analysis — to a model that
  runs **entirely on the device**.
- In that mode the task makes **zero network calls** (MUST) — no relay, no third party — and this
  is enforced by automated contract tests, not merely intended.
- The model is downloaded once on demand from a single trusted source, integrity-verified before
  use, resumable, and removable.
- Because it is experimental and hardware-sensitive, it lives behind a developer-mode switch with a
  risk notice and a two-step enable. With the switch off, the app behaves as if the feature does not
  exist. Image extraction always uses the hosted AI (on-device handles text only).
- The product must not offer to load a model that exceeds the device's safe memory budget (the
  hardware floor is a modest laptop; an over-large model can hard-crash the machine). On **iOS** the
  budget is tighter and per-device: on-device AI is offered **only** on hardware that clears the
  memory floor (high-RAM iPads/iPhones) and is hidden everywhere else; on constrained devices the
  app behaves exactly as if the feature does not exist, and the hosted path remains fully functional.
  Image extraction is always hosted on every platform.

---

## 7. Key user journeys (acceptance-level)

1. **First five minutes.** Launch → choose region → "bring in my statements" → drop in a CAS PDF
   (enter password) → review the parsed draft → commit → see a full net-worth picture and allocation.
   *Done when* the dashboard shows a correct total with no duplicates and the user touched no settings.
2. **Instant demo.** Launch → "load demo" → explore every tab with realistic data and 18 months of history. *Done when* every feature has something to show and the numbers reconcile.
3. **Get a review.** From a populated portfolio → AI Analysis → read the streamed review → ask a follow-up → optionally preview the exact JSON that was sent. *Done when* the review is India-correct, grounded only in the Brief, and the sent data is inspectable.
4. **Add a screenshot the parser can't read.** Add data → pick a statement image → confirm sending this one document → review the AI-extracted editable draft → commit. *Done when* nothing was sent before the explicit confirm and nothing was saved before review.
5. **Go fully private.** Privacy → switch to "my own key" → analysis now goes straight to the AI provider with a key held in the OS keystore, never the relay, never the app's web layer. *Done when* the relay is provably out of the path.
6. **Leave.** Privacy → export everything (one file) and/or erase all (gone immediately). *Done when* export round-trips and erase truly deletes.

---

## 8. Derived computations (the deterministic core)

All of these are computed on-device and are the subject of the strongest tests.

- **8.1 Net worth** = sum of visible account values in base currency, liabilities negative.
- **8.2 Allocation** = visible holdings grouped by the requested dimension (type/account/tax/region/institution), as values and percentages, with a lay-bucket roll-up.
- **8.3 Concentration** = a Herfindahl-style score plus the top holding(s), surfaced in plain words.
- **8.4 P&L** = market value − cost basis, **real bases only**, with coverage %. Holding period from buy date feeds STCG/LTCG buckets. Estimated bases are excluded from all P&L and tax math.
- **8.5 The Brief (the single outbound artifact, MUST be constrained).** A compact, deterministic
  summary: totals, percentages, allocation breakdowns, concentration metrics, tax-wrapper coverage,
  a gains block, and the *names* of top holdings with their real-only gain %. It MUST NOT contain raw
  files, full holding lists with identifying cost data, or instrument identifiers (no ISINs). Its
  exact key set is fixed and tested. Foreign values in the Brief are converted to a single currency
  at the boundary. The user's free-text context is appended *after* the Brief so it tailors the review
  without altering the guarded summary.
- **8.6 History & flows.** Per-account daily snapshots recorded on every change and on load;
  classified flows recorded whenever a change's cause is known; growth derived as the residual so
  growth + flows + tracking + unclassified = total change, exactly.

**Cross-surface consistency (MUST).** The same quantity must be identical wherever it appears — the
hero net worth, the chart, and the outbound Brief must agree to the rupee, in every region. (This is
a named, tested invariant; a past defect where these disagreed is the reason it exists.)

---

## 9. What may leave the device — exhaustive

Only these three categories, each under the stated condition. Anything else is a defect.

1. **The Brief** — only for AI analysis, only the constrained summary of §8.5, viewable by the user. Chat follow-ups go with it.
2. **A single document the user explicitly chose to AI-extract** — only after a per-document confirm, only when deterministic parsing can't handle it, and never when the on-device engine is selected for text.
3. **Anonymous public lookups** — market prices (tickers/scheme codes only) and the public FX rate. No holdings, amounts, or identity.

Transports for category 1 (user's choice): a **stateless relay** that holds the provider key, stores
nothing, and logs no request bodies; **or** the user's **own key**, kept in the OS keystore and never
exposed to the app's web layer, calling the provider directly. In on-device-AI mode, category 1 does
not leave the device at all.

---

## 10. Non-functional requirements

- **Security (MUST).** No secrets in the repository or in saved data. The user's own API key lives
  only in the OS keystore, never reachable from the app's web/JS layer (so even a content-injection
  bug cannot read it). Strict content-security policy; no dynamic-link or script injection sinks; all
  rendered model output is treated as untrusted (no live links, no HTML execution). Network egress is
  restricted to an explicit host allowlist, re-validated on every redirect hop, HTTPS enforced. The
  relay authenticates before reading any body, caps body size, and constant-time-compares tokens.
  **No** build embeds any credential — hosted-relay access is a user-entered access code (matched
  against the relay's `APP_TOKENS`), never a baked-in token, so an extractable binary carries nothing
  a stranger could use to spend the owner's AI budget. Distributable binaries must not embed local
  filesystem paths or personal identifiers (enforced by a build-time check that aborts the release).
- **Privacy verification.** Automated scans assert no personal data and no secrets are committed; a contract test asserts the egress host set, the CSP, and the Brief key-allowlist are exactly as specified.
- **Accessibility (MUST).** Meets WCAG A/AA (no serious/critical violations). Large, high-contrast type; semantic labels on all controls; respects reduced-motion; colors carry text-grade contrast for any color used to convey meaning.
- **Determinism.** All displayed numbers and the Brief are reproducible from the same inputs. Visual output is reproducible for regression testing (time is freezable).
- **Offline.** Everything except AI analysis and live lookups works with no network. On-device-AI mode adds offline analysis too.
- **Performance / footprint.** Smooth on a modest laptop (the stated hardware floor is an 8 GB consumer machine). Any on-device model must respect a safe memory budget for that floor.
- **Robustness of import.** Real broker/CAS exports vary wildly; the importers must tolerate messy, sectioned, multi-currency, multi-sheet inputs and fail gracefully (clear warnings, never silent wrong numbers).
- **Internationalization of money.** ₹ with lakh/crore by default; correct currency formatting per region; a single internal base currency.
- **Responsive / touch (MUST).** One codebase renders correctly from phone to desktop: fluid layout, no horizontal scrolling, portrait and landscape, touch targets sized for fingers, and no interaction that requires hover or a right-click. Chart inspect/zoom works by touch (tap/long-press/drag) as well as by pointer.
- **Mobile (iOS) storage & at-rest (MUST).** The portfolio is stored in the app's **sandbox container** (no other app can read it; the user cannot browse into it). At rest it is protected by iOS's **always-on, hardware-backed Data Protection** keyed to the device passcode — no user setup, and the product does not need to ask the user to enable disk encryption as it does on desktop. The portfolio file is tagged for the strongest practical protection class consistent with launch-time reads, and is **excluded from iCloud backup by default** (§4, principle 1); the user's own API key is held in the **iOS Keychain / Secure Enclave**, unreachable from the web/JS layer and marked **non-syncable** so it never leaves the device via iCloud Keychain. The web-view's own script-writable storage is **never** the system of record for portfolio data — WebKit can evict it — so the native sandbox file is authoritative.

---

## 11. Distribution requirements

### 11.1 Desktop (macOS, Windows)
- Ships as a **native desktop app for macOS and Windows**; a browser build exists for development only.
- Installation is trivial for a non-technical user: download and run; no toolchain, no scripts, no command line.
- The macOS path supports (and is wired for) Developer-ID signing + notarization so it opens without security warnings; an unsigned-build fallback with documented first-launch steps is acceptable in the interim.
- Windows ships an installer built by CI on a release tag; per-user install with no elevation prompt.
- Releases are reproducible from a single release process that also enforces the security build-time checks of §10.
- Source may be private; released binaries are public. Saved-data format is open and documented (export round-trips).

### 11.2 iOS (iPhone + iPad) — native
- Ships as a **single universal iOS app** that adapts to iPhone and iPad form factors (§3, §10 responsive/touch). The same web UI and **all** deterministic/parsing logic are shared with desktop; only the platform-native edges differ (file picker, share-sheet export, OS keystore, at-rest tagging, on-device-AI hardware gating). A region/feature fork is not permitted — iOS is the same engine on a different shell.
- Builds are produced by CI for the iOS target and run on the iOS Simulator for automated checks (§12) before any device build.
- **Distribution requires Apple Developer Program enrollment** (there is no unsigned/sideload escape hatch as on desktop). Public release is via the **App Store**; pre-release testing via **TestFlight**; small private testing via ad-hoc provisioning. This makes the iOS channel **gated on the Apple-enrollment decision**, not on engineering — and it batches naturally with macOS signing/notarization (§11.1).
- **App Store privacy disclosures must be accurate**: portfolio data is not collected; the **Brief** and any user-chosen document for extraction are sent to the AI provider only as described in §9 (and are not used for training); market/FX lookups are anonymous. Labels must match §9 exactly.
- A child/family-sharing-friendly, no-account install (consistent with §4's "no sign-in") — the app is fully usable immediately after install with the demo, same as desktop.

### 11.3 Why not a PWA on iOS
A hosted PWA is **not** an acceptable substitute for the native iOS app: WebKit can **evict script-writable storage** (the only place a PWA could keep data) after a period of non-use, which is unacceptable for an app that may hold the sole copy of a user's net worth; a PWA also loses Keychain/Secure-Enclave key isolation and the at-rest guarantees of §10. The browser build remains development-only.

---

## 12. Definition of done / quality gates

A change is shippable only when **all** of the following pass:

- Unit tests for every deterministic computation (import parsers, classification, allocation, P&L, snapshots, flows, the Brief).
- The named cross-surface invariants: Brief key-allowlist + no-identifier serialization, egress-host set == CSP == allowlist (exact), the hero/chart/Brief net-worth agreement in every region, schema migration from a frozen legacy fixture, and store-operation ordering invariants.
- Type-checks clean; the native layer's tests pass (keystore round-trip, network allowlist).
- An **end-to-end smoke test** drives the *built* app through the whole first-run journey (onboarding, region swap, import, commit, demo, every tab, export, erase) in both regions, with no raw-data leak and no wrong currency.
- An **accessibility gate** (no serious/critical WCAG issues) and **visual-regression** baselines (deterministic, time frozen).
- The **privacy/PII scan** and **secret scan** find nothing.
- For any on-device-AI prompt change: a full extraction-accuracy eval re-run (the prompt is brittle; any byte change can regress extraction, so the whole suite is re-run).
- For the iOS target: the app builds for iOS and the first-run journey passes on the **iOS Simulator** (a phone and an iPad device profile) — same script as the desktop smoke test, plus the touch/responsive layout and the iOS edges (document-picker import, share-sheet export, Keychain key round-trip, backup-exclusion flag set). The accessibility and visual-regression gates run on the mobile layouts too.

---

## Appendix A — Reference implementation

*This appendix is the one place implementation choices are recorded. It is informative, not
normative: a re-implementation may choose differently as long as everything above still holds.*

- **Shell:** a Rust + web-view framework (Tauri-class) that targets **macOS, Windows, and iOS** from one codebase (and runs as a plain web app for development). The native layer owns the OS keystore, the network fetch with host allowlist, and the on-device model. iOS uses the system WebView (WKWebView, same engine as the macOS build), so the entire UI and all TypeScript domain/parsing logic — including the on-device CAS/PDF/CSV/Excel parsers and reconciliation — port unchanged; the native surface that needs per-platform work is small (≈ keystore → iOS Keychain, save dialog → share sheet, file open → document picker, at-rest tagging + backup-exclusion, and gating/disabling the embedded model on low-RAM devices).
- **UI:** a component framework (React-class) with a small client-side store; an editorial visual style (a variable serif for display headings, a humanist sans for body and *all* figures — numbers are never set in serif), warm-paper background, sentence-case microcopy.
- **Persistence:** a single human-readable JSON document in the app's data directory.
- **AI access:** a stateless serverless relay (an edge-worker) holding the provider key; or the user's own key in the OS keystore. On-device model via an embedded small-LLM runtime, a ~4B-parameter quantized model downloaded on demand and integrity-checked.
- **Market data / FX:** public market-data and FX endpoints behind the native host allowlist.
- **Provider:** Claude (Anthropic) — selectable model tiers presented as thoroughness levels.
- **Quality tooling:** a unit-test runner, an end-to-end browser driver against the built app, an accessibility auditor, visual-regression snapshots, mutation testing as a diagnostic, and shell-based PII/secret scanners; CI runs the lot on every push with all third-party actions pinned.

---

## Appendix B — Glossary

- **Brief** — the compact, deterministic, inspectable summary that is the *only* portfolio data sent for AI analysis.
- **CAS** — Consolidated Account Statement; in India, the CAMS/KFintech mutual-fund CAS and the NSDL/CDSL depository CAS. Parsed entirely on-device.
- **Estimated basis** — a cost basis the app inferred (value at first import) because no real purchase price was known; flagged, shown with a marker, and never trusted for tax math.
- **Flow / tracking / growth** — the three-way split of why net worth changed: real money in/out (flow), coverage change (tracking), and the residual (growth).
- **Region profile** — the per-country layer (formatting, tax language, persona, available instruments) applied over one shared engine.
- **Relay** — the stateless server that holds the provider key so clients need no credential; stores nothing.
- **Snapshot** — a real per-account record of one day's net worth; not a re-derivable cache.
</content>
</invoke>
