# Getting started with Sampatti

From zero to an AI-reviewed portfolio in about 20 minutes. Everything stays on your machine —
statements are parsed locally; only a compact numeric summary is sent to Claude, and only
when you run the analysis.

## 1. Install

**macOS (Apple Silicon):** download `Sampatti_<version>_aarch64.dmg` from the
[releases page](https://github.com/miteshs/sampatti-releases/releases), open it, and
**double-click Sampatti** — it offers to move itself into *Applications* (click **Move to
Applications**), then reopens from there. No drag, no Homebrew. The app is signed with an Apple
Developer ID and notarized by Apple, so it opens normally on first launch — no Gatekeeper warning.

**Windows (x64):** download `Sampatti_<version>_x64-setup.exe` from the same
[releases page](https://github.com/miteshs/sampatti-releases/releases) and run it. SmartScreen
will object once (unsigned build): **More info → Run anyway**. Details in [windows.md](windows.md).

## 2. One-time setup (Settings ⚙)

- **Connect Claude** — paste the **access code** you were given into *Settings → Access code*;
  that is all the hosted relay needs (nothing is baked into the app). Prefer no third party in the
  path? Turn on **Developer mode** and choose *My own key* — your Anthropic API key
  (`platform.claude.com` → API keys) is stored in the macOS Keychain (on Windows: the Credential
  Manager) and never leaves your machine except to call Anthropic directly.
- **USD→INR rate** — tap the refresh button to pull the live rate if you hold US assets
  (RSUs/ESPP/US brokerage).
- Optional: pick the analysis model — Sonnet is the balanced default; Opus is the most
  thorough for India tax nuance.

## 3. Gather your statements into one folder

**The two-file shortcut (covers most Indian portfolios):**

1. Your monthly **NSDL/CDSL CAS email** — every demat stock, ETF, REIT and SGB across all
   your demat accounts, plus MF folios. (Password: usually your PAN in capitals.)
2. The **detailed CAMS/KFintech CAS** from
   [camsonline.com → Statements → CAS](https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement)
   — every mutual fund **with purchase costs**, which powers true P&L and tax tooling.

Both are password-protected PDFs and both are parsed **entirely on this device** — Sampatti
asks for the password in-app and never stores or sends it.

For everything the CAS doesn't cover, add the platform's own export:

| Account | Best export |
|---|---|
| Indian broker (Zerodha, Groww, …) | Holdings CSV/XLSX — include *Buy value / Avg. cost* columns |
| US broker (Schwab, Fidelity, …) | Positions CSV — include *Cost Basis* and *Date Acquired* |
| RSU/ESPP plan | The plan's holdings/share-detail sheet |
| Anything else | A PDF statement or even a screenshot works (read by Claude, after you confirm) |

No clean export for something (flat, PPF, FD, insurance, physical gold)? Skip it — you'll add
those by hand in step 5.

> Already imported a platform export *and* a CAS? The review card flags overlapping holdings
> and offers one-click removal of exact duplicates, so nothing double-counts.

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
- **Overview** — sanity-check net worth and allocation; every headline number carries a
  plain-words read. Your real net worth is recorded automatically every day you open the
  app and charts itself as history accumulates.
- **Performance** — your portfolio stacked account by account over time (the **All** view
  reaches back to your oldest purchase using cost bases; drag across the chart to zoom any
  range), plus P&L for every holding **with a real purchase cost on file** — holdings
  without one are left out rather than estimated; add costs in Manage to include them.

## 6. Run the AI analysis

**AI Analysis → ✨ Analyze my portfolio.** You can preview the exact JSON brief being sent
(it's totals, percentages and top holding names — never your statements). You'll get a
SEBI/CFP-style read on concentration, diversification, India tax (LTCG/STCG, 80C, NPS, SGB),
liquidity, and retirement — then ask follow-ups in plain language ("how do I trim my
single-stock risk tax-efficiently?").

Re-import fresh statements monthly (step 4 — they'll upsert, not duplicate), refresh prices
in between, and re-run the analysis whenever the picture changes.
