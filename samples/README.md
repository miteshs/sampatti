# samples/ — verify the importer against real broker exports

Drop **real** broker/demat exports (CSV or Excel) into this folder and run:

```bash
npm run verify:imports
```

It parses each file with the same local parser the app uses and prints what it extracted —
holdings count, account(s), totals per currency, and any warnings — so you can compare against
the actual statement.

**Privacy:** parsing is 100% local. Nothing here is uploaded, and everything in this folder
(except this README) is gitignored, so your real statements never get committed.

**What to expect**
- `✓` parsed locally — eyeball the totals/currency against the statement.
- `⚠` 0 holdings recognized — in the app this shows a one-click **“Parse with Claude”** fallback.
- `✗` crashed — please report it (these should never happen).

PDFs and screenshots aren’t parsed locally; in the app they go to Claude after you confirm.

See `../scripts/indian-brokers.md` for the broker-by-broker map of which exports we expect to
handle locally vs. via Claude.
