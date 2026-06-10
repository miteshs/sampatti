# Sampatti — private, India-first portfolio analysis

A desktop app that aggregates everything you own — Indian stocks, mutual funds, ELSS, PMS/
AIF, debt funds, EPF/PPF, NPS, FDs, gold/SGB, insurance, US RSUs, real estate — into one
allocation view, and gives you an **interactive AI portfolio review** acting as a top Indian
financial analyst. Your data lives on your machine; only a compact summary goes to Claude.

Built on a **Tauri + React** core: the desktop app ships for **macOS** (`.dmg`, Homebrew
cask) and **Windows** (`.exe`, NSIS installer built by CI), and the same code runs as a
plain web app for development.

## What it does

- **Bring in data any way you have it** — the canonical CSV/Excel format (parsed on-device),
  or a PDF/screenshot of a statement (read by Claude, with your confirmation, then shown to
  you as an editable draft before anything is saved).
- **Dashboard** — net worth, and allocation by **asset class / account / tax class / region /
  account type / institution**, with concentration and data-freshness panels.
- **AI Analysis (interactive)** — a streamed review covering concentration, diversification,
  India tax (equity LTCG/STCG, debt slab taxation, ELSS/80C, NPS/80CCD(1B), SGB, harvesting),
  liquidity, and a retirement/income read — then a chat box to ask follow-ups.
- **Privacy by construction** — see [PRIVACY.md](./PRIVACY.md).

Try it instantly with **Add data → Load demo portfolio** (a hypothetical ~₹12 Cr HNI).

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
npm run tauri build                     # → src-tauri/target/release/bundle/dmg/Sampatti_*.dmg
```

Sign + notarize so it opens without Gatekeeper warnings:

```
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run tauri build                     # Tauri signs, then submits to Apple notarization
```

The user just downloads the `.dmg`, drags Sampatti to Applications, and opens it — no git, no
build, no install scripts.

## Build the Windows app (`.exe`)

CI does this: pushing a `v*` tag runs
[`.github/workflows/windows-release.yml`](.github/workflows/windows-release.yml) — tests,
NSIS x64 installer, upload to the public releases repo. Manual builds for click-testing:
Actions → *windows-release* → Run workflow. On an actual Windows machine a plain
`npm run tauri build` works (`tauri.windows.conf.json` selects the NSIS target).
Install/runbook details: [`docs/windows.md`](docs/windows.md).

## Install with Homebrew

Once a release is published to a tap (see [`docs/homebrew.md`](docs/homebrew.md)):

```
brew tap miteshs/sampatti
brew install --cask sampatti
```

The cask lives at [`packaging/homebrew/sampatti.rb`](packaging/homebrew/sampatti.rb);
`scripts/release.sh` builds the dmg, computes its sha256, and updates the cask. Publishing
needs a **public** download URL for the dmg and (ideally) Developer-ID **signing + notarization**
— details and the unsigned-build workaround are in `docs/homebrew.md`.

## How analysis reaches Claude

Two modes, switchable on the Privacy screen:

- **Relay (default)** — a tiny stateless [relay](../relay) holds the Anthropic key so clients
  need nothing. It forwards the brief and stores nothing.
- **My own key (max privacy)** — the app calls Anthropic directly with a key kept in the
  macOS Keychain / Windows Credential Manager (desktop) and never touches the relay.

## Layout

```
src/domain      types, classification/alias maps, allocation grouping, the Portfolio Brief
src/ingest      CSV / Excel / PDF parsing + the Claude document-extraction pipeline
src/storage     the on-device portfolio store (one JSON file)
src/claude      transport (relay/BYO, streaming) + the analyst prompts
src/platform    Tauri-vs-web abstraction (storage, keychain, network)
src/components   Overview, AnalysisChat, AddData, Privacy, Donut, Markdown
src-tauri        the Rust shell: OS keystore + the native Claude stream, macOS/Windows bundle config
```

Educational use only — not a substitute for a SEBI-registered investment adviser.
