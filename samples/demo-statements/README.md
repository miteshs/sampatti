# Recreate the demo portfolio from a file

Prefer not to click **Load demo** in the app? You can import the sample portfolio instead.

## Recreate the FULL demo — including the ~18-month trend (recommended)

In the app: **Settings → Privacy & data → Import a backup (.json)**, then pick your region:

- India: [`india/sampatti-demo-india.json`](india/sampatti-demo-india.json)
- US: [`us/sampatti-demo-us.json`](us/sampatti-demo-us.json)

These are full Sampatti **backup exports** — accounts, holdings, cost bases **and** the recorded
daily history — so the entire demo comes back exactly: net worth, allocation, P&L, the health
score, and the trend chart. (The history is a snapshot frozen when the file was generated.)

## Practice the real import flow — holdings only

Each region's `statements/` folder holds the *same* portfolio as a mix of **CSV / Excel / PDF /
screenshot** statements — the kind you'd download from brokers or a CAS. In the app, go to
**Holdings → Import a whole folder** and pick a region's `statements/` folder to watch the
parse-and-review flow. These reproduce the **holdings** (so net worth / allocation / P&L match),
but **not** the trend history — that builds fresh from the import day, because no statement
carries daily history.

---

All files here are **synthetic** — no real person's data. To regenerate after the demo changes:

```
GEN_DEMO=1 npx vitest run --config scripts/vitest.config.ts scripts/gen-demo-statements.test.ts
```
