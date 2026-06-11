# Verification strategy

Sampatti makes three promises that ordinary feature tests don't cover: **nothing leaves the
device**, **your data never corrupts**, and **imports never lie**. The suite is organized so
each promise is an executable check, not a convention. Two real bugs (a silently-broken
export button, a misaligned panel) shipped past 250+ unit tests and were caught by eyes —
the e2e/visual layers below exist so that class of bug can't ship again.

## The layers

| Layer | What it guards | Run |
|---|---|---|
| Unit/component (vitest, `src/**`) | Domain math, parsers, stores, per-OS copy, render behavior | `npm test` |
| **Promise contracts** (`src/contracts.test.ts`) | Brief key-allowlist (no units/dates/folios/ISINs to Claude); CSP == Rust `MARKET_HOSTS` == agreed egress, **exact set**; app models ⊆ relay; version triple-match | in `npm test` |
| **Durability** (`src/storage/migration.test.ts`, `invariants.test.ts`) | Frozen oldest-schema file loads losslessly forever; snapshot ≡ live sums, basis on every holding, well-formed ledger after every mutation | in `npm test` |
| **Fuzzing** (`src/ingest/fuzz.test.ts`, fast-check, seed 1991) | Parsers never hang/NaN on ANY input; `rowTriple` consistency; reconciliation bounds | in `npm test` |
| Rust (`src-tauri`) | Keystore is a REAL OS store (not the mock), round-trip, market-URL allowlist, UTF-8-safe error paths | `cargo test` |
| Relay (`relay/`) | Auth-before-body, stream cap, model/token clamps | `cd relay && npx vitest run` |
| **E2E smoke** (`scripts/e2e/smoke.mjs`) | The whole journey in real Chrome against the BUILT app: welcome → CSV import → commit → demo → all tabs → export feedback → erase-leaves-nothing → zero page exceptions → **axe-core WCAG A/AA gate** (serious/critical fail) | `npm run e2e` |
| **Visual regression** (`scripts/e2e/visual.mjs`) | Pixel-diff of all six tabs vs committed baselines, clock frozen for determinism | `npm run e2e:visual` |
| PII/secrets (`scripts/pii-scan.sh`) | No personal data or secrets in committable files (personal patterns live in the gitignored `scripts/.pii-denylist`) | pre-commit |
| Real-statement harness (`npm run verify:imports`) | Your actual broker exports + CAS PDFs in gitignored `samples/` parse correctly, locally | manual |
| Mutation diagnostic (`npm run mutate`, Stryker) | Whether domain tests actually assert (one-off audit, NOT a gate) | manual |

## CI

- **quick-gates** (every push/PR, ubuntu 1×): vitest + tsc + relay tests + `npm audit
  --omit=dev` · `cargo audit` (RUSTSEC) · the e2e smoke on real Chrome.
- **windows-release** (tags + dispatch): full gates on Windows incl. a real Credential
  Manager round-trip, then the NSIS build.
- All actions are **pinned by commit SHA** (tag comments alongside).

## Release-time guards (`scripts/release.sh`)

- mkdir-based **build lock** — a concurrent token-ful personal build once contaminated the
  public bundle mid-release (2026-06-10); the token grep caught it, the lock now prevents it.
- dist token-grep (binary `strings`-grep is deliberately NOT used: Tauri brotli-compresses
  embedded assets, so it would be false confidence — the solo-build dist grep is the sound check).
- Bundled `Info.plist` version must equal the released version.
- When signing is configured: spctl + stapled-ticket verification before publishing.

## Working with the gates

- **Visual baselines**: per-platform under `scripts/e2e/baselines/<darwin|linux>/`. After an
  intentional UI change: `npm run e2e:visual -- --update` and commit the PNGs. On a platform
  with no baselines yet (CI linux today), the run saves candidates to
  `scripts/e2e/.candidates/` and passes with a notice — commit those to arm the gate there.
- **Axe failures**: only `serious`/`critical` fail; lesser impacts print as notes. Fix the
  component (the design system has text-grade color tokens `--up-ink`/`--down-ink` for
  exactly this) rather than suppressing the rule.
- **Egress changes**: adding any network endpoint requires updating the CSP, possibly
  `MARKET_HOSTS`, *and* the expected set in `contracts.test.ts` — that friction is the point.
- **New asset classes**: `CLASS_BUCKET` is exhaustive-by-type; the compiler plus
  `buckets.test.ts` force a bucket decision.

## Deliberately not adopted (yet)

- **tauri-driver desktop e2e** — heavyweight per-OS WebDriver infra; the webview app is
  covered by the Chrome smoke, and the native seam (keystore, fs, market fetch) by Rust
  tests + the Windows CI round-trip. Revisit if web and desktop behavior ever diverge.
- **Mutation testing as a CI gate** — runtime is minutes per module; keep it a manual
  audit (`npm run mutate`) after big domain changes.
