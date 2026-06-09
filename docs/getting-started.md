# Getting started with Sampatti

From zero to an AI-reviewed portfolio in about 20 minutes. Everything stays on your Mac —
statements are parsed locally; only a compact numeric summary is sent to Claude, and only
when you run the analysis.

## 1. Install

```sh
brew tap miteshs/sampatti
brew trust miteshs/sampatti     # Homebrew asks this once for third-party taps
brew install --cask sampatti
```

(No Homebrew? Download the `.dmg` from the [releases page](https://github.com/miteshs/sampatti-releases/releases),
drag **Sampatti** into *Applications*, then right-click → **Open** on first launch — the build
is unsigned for now.)

## 2. One-time setup (Privacy tab)

- **Connect Claude** — add your own Anthropic API key (`platform.claude.com` → API keys). It's
  stored in the macOS Keychain and never leaves your machine except to call Anthropic directly.
- **USD→INR rate** — tap the refresh button to pull the live rate if you hold US assets
  (RSUs/ESPP/US brokerage).
- Optional: pick the analysis model — Sonnet is the balanced default; Opus is the most
  thorough for India tax nuance.

## 3. Gather your statements into one folder

Make a folder (e.g. `~/Desktop/statements`) and download a holdings/positions export from
**every** account. Prefer **CSV/Excel** over PDF — they parse entirely on-device — and pick
the export that includes **cost basis / buy value** where your broker offers one, so you get
true P&L and (later) tax tooling:

| Account | Best export |
|---|---|
| Indian broker (Zerodha, Groww, …) | Holdings CSV/XLSX — include *Buy value / Avg. cost* columns |
| Demat (CDSL / NSDL) | Holding Statement (XLSX) |
| Mutual funds | CAMS / KFintech holdings export, or your platform's CSV |
| US broker (Schwab, Fidelity, …) | Positions CSV — include *Cost Basis* and *Date Acquired* |
| RSU/ESPP plan | The plan's holdings/share-detail sheet |
| Anything else | A PDF statement or even a screenshot works (read by Claude, after you confirm) |

No clean export for something (flat, PPF, FD, insurance, physical gold)? Skip it — you'll add
those by hand in step 5.

## 4. Import the whole folder

**Add data → 📁 Import a whole folder.** CSV/Excel files are parsed on this device; if
anything needs Claude (PDFs, images, or an unrecognized layout), you'll be shown exactly
which files **before** anything is sent.

Each statement becomes a **review card** — nothing is saved until you say so. On each card:

- Check the **account name, institution and currency** (flip INR/USD if a US sheet came in wrong).
- Scan the holdings: fix a mislabeled **asset class**, correct a value, fill in a missing
  **cost basis / buy date**, or ✕ junk rows.
- Check **"Apply to"**: first import of an account → **New account**. Re-importing a newer
  statement of an account you already have → **Update: <that account>** (it replaces that
  account's holdings — sold positions drop off, nothing duplicates). The app preselects and
  warns when it spots a match.
- Save. Repeat for each card.

Don't aim for perfection here — **everything is editable later** (Manage → ✎: every account
field, every holding, cost basis, buy dates).

## 5. Round out the picture

- **Add data → Manual entry** — real estate, PPF/EPF, FDs, insurance, PMS, and **gold by
  weight** (grams × live price). Add loans as a *Liability* account so net worth is honest.
- **Add data → Income** — salary, rent, dividends (powers the retirement sense-check).
- **Manage tab** — ✎ to fix anything, untick accounts to exclude them from all analysis,
  **Refresh live prices** to mark everything to market.
- **Overview** — sanity-check net worth and allocation. Your real net worth is recorded
  automatically every day you open the app and charts itself as history accumulates.
  **Performance** shows every holding's P&L — rows marked ≈ have no purchase cost on file;
  add real costs whenever you find them — and can simulate the past year from market data
  (clearly labelled as a what-if, since it back-prices today's holdings).

## 6. Run the AI analysis

**AI Analysis → ✨ Analyze my portfolio.** You can preview the exact JSON brief being sent
(it's totals, percentages and top holding names — never your statements). You'll get a
SEBI/CFP-style read on concentration, diversification, India tax (LTCG/STCG, 80C, NPS, SGB),
liquidity, and retirement — then ask follow-ups in plain language ("how do I trim my
single-stock risk tax-efficiently?").

Re-import fresh statements monthly (step 4 — they'll upsert, not duplicate), refresh prices
in between, and re-run the analysis whenever the picture changes.
