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
| `schwab-taxable-positions.csv` | CSV | Schwab Taxable | 6 | Local (exact) |
| `fidelity-401k.xlsx` | XLSX | Fidelity 401(k) | 2 | Local (exact) |
| `vanguard-roth-ira.csv` | CSV | Vanguard Roth IRA | 2 | Local (exact) |
| `hsa-bank-screenshot.png` | PNG | HSA Bank | 2 | Claude vision (approx.) |
| `treasury-and-cds.csv` | CSV | Treasury & CDs | 2 | Local (exact) |
| `coinbase-screenshot.png` | PNG | Coinbase | 2 | Claude vision (approx.) |
| `carta-rsu-statement.pdf` | PDF | RSU — Stripe (Carta) | 1 | Claude vision (approx.) |
| `empower-old-401k.xlsx` | XLSX | Old Employer 401(k) — Empower | 1 | Local (exact) |
| `zerodha-nri-holdings.csv` | CSV | Zerodha (NRI demat) | 2 | Local (exact) |
| `home-austin-valuation.pdf` | PDF | Home — Austin | 1 | Claude vision (approx.) |
| `rocket-mortgage.csv` | CSV | Mortgage | 1 | Local (exact) |

_All figures are synthetic. Regenerate with the GEN_DEMO command in the parent README._
