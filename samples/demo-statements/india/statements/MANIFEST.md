# Sample statements — this folder

The **same** portfolio as the region's `sampatti-demo-*.json` backup, split into the mix of
formats you'd actually download from brokers and portals. Import the whole folder via
**Holdings → Import a whole folder**.

- **CSV / Excel** parse 100% on-device and reproduce holdings, units, cost basis and buy dates
  exactly (verified at generation time).
- **PDF / screenshot** go through Claude vision (you'll be asked to confirm before anything is
  sent). They're realistic but approximate, and — like all statements — carry **no daily history**.
  For the exact demo including the ~18-month trend, import the `.json` backup instead.

| File | Format | Account | Holdings | Parses |
|---|---|---|---|---|
| `zerodha-holdings.csv` | CSV | Zerodha Demat | 11 | Local (exact) |
| `cams-equity-funds.xlsx` | XLSX | Equity Mutual Funds | 7 | Local (exact) |
| `debt-funds.csv` | CSV | Debt Funds | 2 | Local (exact) |
| `marcellus-pms-statement.pdf` | PDF | Marcellus PMS | 1 | Claude vision (approx.) |
| `edelweiss-aif-statement.pdf` | PDF | Edelweiss AIF | 1 | Claude vision (approx.) |
| `avendus-private-markets.pdf` | PDF | Private Markets | 2 | Claude vision (approx.) |
| `nps-cra-screenshot.png` | PNG | NPS Tier-1 | 1 | Claude vision (approx.) |
| `epfo-passbook-screenshot.png` | PNG | Provident Fund | 2 | Claude vision (approx.) |
| `hdfc-bank-deposits.csv` | CSV | Bank & Deposits | 2 | Local (exact) |
| `gold-holdings.csv` | CSV | Gold | 2 | Local (exact) |
| `lic-policy-statement.pdf` | PDF | LIC Endowment Policy | 1 | Claude vision (approx.) |
| `morgan-stanley-stockplan.xlsx` | XLSX | Morgan Stanley (RSU/ESPP) | 2 | Local (exact) |
| `schwab-positions.csv` | CSV | Schwab Brokerage | 3 | Local (exact) |
| `crypto-wallet-screenshot.png` | PNG | Crypto Wallet | 1 | Claude vision (approx.) |
| `zerodha-huf-holdings.csv` | CSV | HUF Demat | 2 | Local (exact) |
| `real-estate.csv` | CSV | Real Estate | 2 | Local (exact) |
| `plot-alibaug.csv` | CSV | Plot — Alibaug | 1 | Local (exact) |
| `groww-folio.csv` | CSV | Groww Mutual Funds | 1 | Local (exact) |
| `hdfc-home-loan.csv` | CSV | Home Loan | 1 | Local (exact) |

_All figures are synthetic. Regenerate with the GEN_DEMO command in the parent README._
