# Sampatti — private portfolio analysis

A desktop app that aggregates everything you own — stocks, mutual funds, ELSS, PMS/AIF,
debt funds, EPF/PPF, NPS, FDs, gold/SGB, 401(k)/IRA, RSUs, insurance, real estate — into one
allocation view, and gives you an **interactive AI portfolio review** acting as a top
financial analyst. It works for **India and US** portfolios today (region-aware currency,
instruments, and tax), with more countries to come. Your data lives on your machine; only a
compact summary goes to Claude.

Built on a **Tauri + React** core: the desktop app ships for **macOS** (signed + notarized
`.dmg`, direct download) and **Windows** (`.exe`, NSIS installer built by CI), and the same
code runs as a plain web app for development.

## What it does

- **Five-minute full import** — drop in your **CAS PDFs** (CAMS/KFintech mutual-fund CAS and
  the NSDL/CDSL depository CAS): password-protected files are decrypted and parsed **entirely
  on-device**, with cross-account duplicate reconciliation so a CAS and a platform export
  never double-count.
- **Bring in anything else any way you have it** — CSV/Excel (parsed on-device), or a
  PDF/screenshot of a statement (read by Claude, with your confirmation, then shown to you as
  an editable draft before anything is saved).
- **Dashboard** — net worth with plain-words verdicts on every headline number, allocation by
  **type / account / tax / region / institution**, daily-recorded net-worth history with a
  growth-vs-money-added split.
- **Performance** — the portfolio stacked account by account over time (back to your oldest
  purchase via cost bases), drag-to-zoom, and P&L strictly from real purchase costs.
- **AI Analysis (interactive)** — a streamed review covering concentration, diversification,
  region-aware tax (India: equity LTCG/STCG, debt slab taxation, ELSS/80C, NPS/80CCD(1B), SGB,
  harvesting; US: LTCG/NIIT, wash sales, 401(k)/IRA/Roth, RSU vesting), liquidity, and a
  retirement/income read — then a chat box to ask follow-ups.
- **Privacy by construction** — see [PRIVACY.md](./PRIVACY.md). Optional **on-device AI**
  (per-task: extraction and/or analysis) that provably makes zero network calls.

Try it instantly with **Add data → Load demo portfolio** (a hypothetical ~₹14 Cr HNI with 18 months of recorded history).

## Run it (development)

```
cd sampatti
npm install
npm run dev          # web preview at http://localhost:1420 (everything works except the
                     # native keychain; BYO key is kept in-tab for the preview)
npm run tauri dev    # the real desktop app (needs the Rust toolchain + macOS/Win/Linux deps)
```

Quality gates:

```
npm run build        # tsc typecheck + production bundle
npm test             # unit tests for the importers and the portfolio brief
```

## Build the macOS app (`.dmg`)

A signed, notarized `.dmg` must be produced **on a Mac** with an Apple Developer ID (it can't
be cross-built from Linux):

```
npm run tauri icon ./brand-icon.png     # generate icons (one-time)
npm run tauri build                     # → src-tauri/target/release/bundle/macos/Sampatti.app
```

Signing, notarization, and the dmg are handled by `scripts/release.sh`, which reads credentials
from a gitignored `.env.signing` (a Developer ID identity + an App Store Connect API key — see
[`.env.signing.example`](.env.signing.example)) and notarizes with `notarytool` directly:

```
scripts/release.sh --gh-release         # build → sign → notarize → staple → verify → publish
```

The user just downloads the `.dmg`, opens it, and **double-clicks Sampatti** — the app installs
itself into Applications (no drag) and opens. No git, no build, no install scripts.

## Build the Windows app (`.exe`)

CI does this: pushing a `v*` tag runs
[`.github/workflows/windows-release.yml`](.github/workflows/windows-release.yml) — tests,
NSIS x64 installer, upload to the public releases repo. Manual builds for click-testing:
Actions → *windows-release* → Run workflow. On an actual Windows machine a plain
`npm run tauri build` works (`tauri.windows.conf.json` selects the NSIS target).
Install/runbook details: [`docs/windows.md`](docs/windows.md).

## Install (macOS)

Download `Sampatti_<version>_aarch64.dmg` from the
[latest release](https://github.com/miteshs/sampatti-releases/releases/latest), open it, and
**double-click Sampatti** — it offers to move itself into Applications, then relaunches from
there. No drag, no `brew`. The app is signed with an Apple Developer ID and notarized by Apple,
so it opens normally on first launch — no Gatekeeper warnings.

`scripts/release.sh` builds the dmg (app-only — no Applications drag alias, so the self-install on
first launch is the obvious action), signs + notarizes it via `notarytool` (credentials from a
gitignored `.env.signing` — see [`.env.signing.example`](.env.signing.example)), staples the
ticket, and publishes it to the public
[releases repo](https://github.com/miteshs/sampatti-releases).

## How analysis reaches Claude

Two modes, configured in Settings (⚙). **Nothing is baked into the build** — no app secret ships
in the binary.

- **Relay (default)** — a tiny stateless [relay](../relay) holds the Anthropic key. You paste the
  **access code** the relay owner gave you (Settings → Access code); the relay checks it against
  its `APP_TOKENS` before forwarding the brief, and stores nothing.
- **My own key (max privacy)** — enable Developer mode in Settings, choose *My own key*, and the
  app calls Anthropic directly with a key kept in the macOS Keychain / Windows Credential Manager
  (desktop) and never touches the relay.

## Layout

```
src/domain      types, classification, allocation grouping, snapshots/flows, the Portfolio Brief
src/ingest      CSV / Excel / CAS (CAMS + NSDL/CDSL) / PDF parsing, duplicate reconciliation,
                and the Claude document-extraction pipeline
src/storage     the on-device portfolio store (one JSON file)
src/claude      transport (relay/BYO, streaming) + the analyst prompts
src/platform    Tauri-vs-web abstraction (storage, keystore, network, OS copy)
src/components   Overview, Performance (AccountStack), Manage, AnalysisChat, AddData, Privacy
src-tauri        the Rust shell: OS keystore + the native Claude stream, macOS/Windows bundle config
```

Educational use only — not a substitute for a SEBI-registered investment adviser.
