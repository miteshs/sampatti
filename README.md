# Sampatti — private, India-first portfolio analysis

A desktop app that aggregates everything you own — Indian stocks, mutual funds, ELSS, PMS/
AIF, debt funds, EPF/PPF, NPS, FDs, gold/SGB, insurance, US RSUs, real estate — into one
allocation view, and gives you an **interactive AI portfolio review** acting as a top Indian
financial analyst. Your data lives on your machine; only a compact summary goes to Claude.

Built on a **Tauri + React** core: the desktop app (a signed `.dmg`) is the shipping
product, but the same code runs as a plain web app, so a Windows build or a hosted web
version is a configuration change, not a rewrite.

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
build, no install scripts. (A Windows `.msi` comes from `tauri build` on Windows; a hosted web
build is just `npm run build` served as static files.)

## How analysis reaches Claude

Two modes, switchable on the Privacy screen:

- **Relay (default)** — a tiny stateless [relay](../relay) holds the Anthropic key so clients
  need nothing. It forwards the brief and stores nothing.
- **My own key (max privacy)** — the app calls Anthropic directly with a key kept in the
  macOS Keychain (desktop) and never touches the relay.

## Layout

```
src/domain      types, classification/alias maps, allocation grouping, the Portfolio Brief
src/ingest      CSV / Excel / PDF parsing + the Claude document-extraction pipeline
src/storage     the on-device portfolio store (one JSON file)
src/claude      transport (relay/BYO, streaming) + the analyst prompts
src/platform    Tauri-vs-web abstraction (storage, keychain, network)
src/components   Overview, AnalysisChat, AddData, Privacy, Donut, Markdown
src-tauri        the Rust shell: keychain + the native Claude stream, macOS bundle config
```

Educational use only — not a substitute for a SEBI-registered investment adviser.
