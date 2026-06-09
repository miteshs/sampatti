# Indian brokers & statement sources — import coverage map

How we expect to handle the top brokers/demat/MF sources. **Local** = our deterministic
CSV/Excel parser (private, free, exact). **Claude** = the opt-in AI fallback (PDFs, or any
layout the local parser can't read).

> Exact CSV/Excel column headers vary by broker and aren't all publicly documented, and they
> change over time. So treat this as a starting map, and **ground-truth each one** by dropping
> a real export into `samples/` and running `npm run verify:imports`. Parsing is local, so
> using real files here is safe.

## Discount / online brokers — usually CSV or Excel holdings exports → **Local**
| Broker | Holdings export | Parse path | Notes |
|---|---|---|---|
| Zerodha (Console) | CSV / Excel | Local | Kite holdings has `Instrument, Qty., Avg. cost, LTP, Cur. val`; Console P&L is Excel. |
| Groww | Excel (Reports) | Local | Balance/holdings statement as Excel; also PDF. |
| Angel One | CSV / Excel | Local | Holdings & P&L exports. |
| Upstox | CSV / Excel | Local | Holdings/report exports. |
| Dhan | CSV / Excel | Local | Holdings export. |
| Fyers | CSV / Excel | Local | Holdings/P&L. |
| 5paisa | CSV / Excel | Local | Holdings/ledger. |
| Paytm Money | Excel / PDF | Local / Claude | Excel where available, else PDF → Claude. |
| Samco / Alice Blue | CSV / Excel | Local | Holdings export. |

## Full-service / bank brokers — CSV/Excel where offered, else PDF
| Broker | Holdings export | Parse path | Notes |
|---|---|---|---|
| ICICI Direct | CSV / Excel | Local | Portfolio export; column names differ from Zerodha. |
| HDFC Securities | Excel / PDF | Local / Claude | Portfolio Excel; statements PDF. |
| Kotak Securities | Excel / PDF | Local / Claude | |
| Motilal Oswal | Excel / PDF | Local / Claude | |
| Sharekhan | Excel / PDF | Local / Claude | |
| IIFL Securities | Excel / PDF | Local / Claude | |
| SBI Securities | Excel / PDF | Local / Claude | |
| Axis Direct | Excel / PDF | Local / Claude | |
| Nuvama (Edelweiss) | Excel / PDF | Local / Claude | |
| Geojit / Anand Rathi | Excel / PDF | Local / Claude | |

## Consolidated statements — PDF (often password-protected) → **Claude**
| Source | Format | Parse path | Notes |
|---|---|---|---|
| CDSL eCAS | PDF | Claude | Consolidated demat holdings across brokers. |
| NSDL CAS | PDF | Claude | Same, NSDL depository. |
| CAMS CAS | PDF | Claude | Consolidated mutual-fund holdings. |
| KFintech CAS | PDF | Claude | Mutual-fund holdings (KFintech-serviced AMCs). |

## How to verify a broker
1. Export your holdings from the broker (prefer CSV/Excel over PDF).
2. Drop it in `sampatti/samples/` and run `npm run verify:imports`.
3. A `✓` row → check the totals/currency match the statement. A `⚠` → the app will offer
   “Parse with Claude.” A `✗` → a bug to fix.
4. If a `Local` broker shows `⚠`, send me one real (anonymized) export and I'll add its column
   aliases so it parses locally — and add it to `scripts/fixtures/` as a regression test.
