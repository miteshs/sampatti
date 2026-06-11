# Privacy — plain language

Sampatti is built so your financial data stays with you. Here is exactly what happens.

## Stored only on your device

Your accounts, holdings, and income are saved to a single file in the app's data folder on
your computer (the Privacy screen shows the exact path). There is **no account, no sign-in, and
no cloud database**. Nothing is uploaded for storage. Back it up or wipe it yourself anytime
(Privacy → Export / Erase).

## What leaves your device — and only this

1. **The portfolio brief.** For the AI analysis we send a compact summary — totals and
   percentages (net worth, allocations, concentration metrics, tax-wrapper coverage) — **not
   your raw files**. Your chat follow-ups are sent with it.
2. **Documents you choose to extract.** CSV and Excel files are parsed on your device and
   never sent — and so are your **CAS PDFs** (the CAMS/KFintech mutual-fund CAS and the NSDL/CDSL depository CAS), including their password handling
   (decryption happens locally; the password is never stored). Other **PDFs or screenshots**
   can't be parsed reliably without AI, so — only after you click confirm — that one document
   is sent to Claude to pull out the holdings, which you then review before saving.
3. **Anonymous price lookups.** Refreshing live prices sends only tickers / scheme codes to
   public market-data services, and the USD→INR rate (fetched automatically when the app
   opens) asks for nothing but the public rate. Neither carries your holdings, amounts, or
   identity.

Nothing else is ever transmitted.

### On-device AI (optional)

On the Privacy screen you can switch either AI task — statement extraction, or the
analysis — to an **on-device model** (downloaded once, integrity-verified, runs inside the
app). In that mode the task sends **nothing anywhere**: no relay, no Anthropic, no network
call at all — enforced by automated contract tests. Claude remains the default for quality.

## What we never see

- In **relay mode**, the brief passes through a stateless relay to Anthropic. The relay binds
  no database and logs no request bodies — it cannot keep your data (see `relay/README.md`).
- In **your-own-key mode**, the brief goes straight from your device to Anthropic and never
  touches our servers at all.
- Anthropic does not train its models on data sent through the API.

## At rest

Turn on full-disk encryption — **FileVault** on macOS (System Settings → Privacy & Security),
**Device encryption / BitLocker** on Windows (Settings → Privacy & security) — so the app's
data file is encrypted with everything else. Your bring-your-own Anthropic key, if you use
one, is stored in the **macOS Keychain** / **Windows Credential Manager** and never enters
the app's web view.

## Your controls

- **Export everything** to a JSON file (Privacy screen).
- **Erase all data** — removes the local file immediately.
- **Switch to your own key** for zero third parties in the analysis path.

This document describes the app's behavior; it is not legal advice.
