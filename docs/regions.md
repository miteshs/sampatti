# Regions — one app, two markets (design & build plan)

**Decision (2026-06-11): ONE codebase, ONE app; the region is a first-class profile, not a
fork.** A US Sampatti and an India Sampatti differ in persona, tax language, number
formatting, demo data and a few ingest affordances — all of it localizable behind one
profile object. Everything just hardened (CI, release, eval harness, e2e, security posture)
stays shared. If "two products" is ever wanted at the marketing layer, a build-time default
(`VITE_REGION_DEFAULT`) can produce separately-branded installers from this same source —
that is a packaging decision, deferred until the US profile earns it.

Rejected: separate repo/app per market. It doubles every gate this repo just paid for
(release pipeline, eval, visual baselines, audits) before a single US user exists, and the
diff between markets is profile-shaped, not architecture-shaped.

## Architecture

```
src/regions/profile.ts   Region = "IN" | "US" — THE seam. One RegionProfile per market:
                         base currency, money formatting (lakh/crore vs K/M), persona
                         country, labels. Components ask the profile, never branch on
                         country themselves.
settings.country         already exists ("India" since v1) — widened to "India" | "US".
                         regionOf(settings) maps it; unknown values fall back to IN.
Welcome (later phase)    first-run choice: "Where do you manage your money?" — sets
                         country + baseCurrency once US is presentable end-to-end.
```

**Sequencing rule:** the region CHOICE ships last. Every commit keeps India behavior
byte-identical (existing tests must keep passing untouched), and US mode is never exposed
half-converted (a $ persona over ₹-formatted screens is worse than no US mode). Seams
first, choice when coherent.

## Build checklist (the /loop works top-to-bottom)

Phase R1 — the seam (no behavior change for existing users)
- [x] This design doc + the decision log
- [x] `src/regions/profile.ts`: Region/RegionProfile, IN profile (delegates to existing
      `inr()`), US profile (USD, $1.2M/K compact formatting), `regionOf`/`profileFor`
      with safe fallback to IN; unit tests
- [x] `Settings.country` widened to `"India" | "US"` (merge migration keeps "India")
- [x] US analyst persona in `prompts.ts` — fee-only fiduciary CFP/RIA; US tax pillars
      (LTCG brackets + NIIT, STCG as ordinary income, wash sale, 401k/IRA/Roth/backdoor,
      HSA, RSU vesting, 529); same brief-grounding + no-invention rules as India's
- [x] `buildBrief` reads baseCurrency from settings (verified pre-existing — the label
      follows the setting; the VALUE-side base conversion is R2's `toBase` item)

Phase R2 — US coherence (work through the ₹ surface; IN output pinned by tests throughout)
- [x] Money-format seam adoption: all 10 money-rendering components now call `fmtMoney`
      (store-backed, region-aware) instead of importing `inr()` directly; `inr` remains the
      IN implementation inside the seam. Visual suite confirmed PIXEL-IDENTICAL for India
      (no baseline change needed) — the adoption itself changed nothing
- [ ] Base-currency generalization: `toBase` → profile-aware (US base: INR→USD divides);
      `usdInr` setting becomes the single FX pair both ways; Privacy FX card copy per region
- [ ] Tax wrappers per region: brief's taxable/exemptEEE/nps → US: taxable/traditional/
      roth/hsa (classify from account names: 401k, IRA, Roth, HSA)
- [ ] Asset-class & affordance gating: hide IN-only surfaces in US mode (CAS import card,
      gold-by-weight ₹/g, SGB/ELSS/EPF-PPF chips in manual entry); US demat = brokerage
- [ ] US demo portfolio (the demo IS the first-run experience; an India demo for a US
      user undermines the pitch) — same synthesized-history machinery, US archetypes
- [ ] Verdicts/buckets copy pass (lay-bucket names read naturally in both markets)

Phase R3 — exposure
- [ ] Welcome region step (one question, two flags) + Privacy "Region" control with a
      plain-words note (changes tax language & formatting, never your data)
- [ ] e2e: region step + a US-mode smoke sweep; visual baselines per region for key screens
- [ ] Eval fixtures: US-broker archetypes already exist; add US-context extraction probes
- [ ] Packaging decision: keep one app vs `VITE_REGION_DEFAULT` branded builds (revisit
      with real US interest; default = one app)

## Decisions log
- One profile object, not scattered `country ===` branches — `prompts.ts` keeps the only
  allowed branch (personas are inherently per-market prose).
- `Region` is two-letter ("IN"/"US") internally; `settings.country` stays the stored
  human value ("India"/"US") for backward compatibility with every existing save file.
- The US persona is written fresh, not a fill-in-the-blank of the India one — tax pillars
  differ in kind (brackets/wash-sale/wrappers vs exemption-limit/classes), and the generic
  `${country}` fallback persona remains for anything else.
