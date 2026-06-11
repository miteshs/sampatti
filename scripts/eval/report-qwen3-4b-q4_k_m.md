# Local extraction eval — qwen3-4b-q4_k_m

2026-06-11 · model `Qwen3-4B-Q4_K_M.gguf` · 8 text fixtures (synthetic, scripts/eval/fixtures)

**Headline: 37/37 holdings matched (name + value ≤1%), 8/8 statement totals within 1%, 8/8 currencies right, median 15.3 tok/s.**

| fixture | holdings (got/want) | matched | value-off | missing | extra | total Δ% | ccy | type | units | cost | time | tok/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demat-equity.csv | 8/8 | 8 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 8/8 | 8/8 | 50s | 15.5 |
| bank-fd.csv | 4/4 | 4 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | — | — | 31s | 15.0 |
| mf-statement.xlsx | 6/6 | 6 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 6/6 | 6/6 | 39s | 15.5 |
| us-broker.xlsx | 5/5 | 5 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 5/5 | 5/5 | 33s | 15.3 |
| mf-statement.pdf | 6/6 | 6 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 6/6 | 6/6 | 48s | 15.7 |
| bank-fd.pdf | 4/4 | 4 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | — | — | 30s | 14.9 |
| pms-letter.pdf | 1/1 | 1 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | — | 1/1 | 16s | 11.5 |
| nps-statement.pdf | 3/3 | 3 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 3/3 | — | 27s | 14.3 |

- matched = name-matched holding with value within 1% of truth; value-off = right holding, wrong value
- extra = model holdings that match no ground-truth row (hallucination risk)
- every extraction lands in the review card — the floor is "annoying", never "silently wrong"

## On-device quick-take probe

quick-take: 73 words in 8s @ 15.8 tok/s; NO invented ₹-scale figures detected

```
- Net worth is ₹24.5 million, with total assets at ₹27 million and liabilities at ₹2.5 million.  
- 36% of assets are liquid, with ₹9.8 million in cash and equivalents.  
- The portfolio is heavily weighted in Indian equity (30%) and real estate (26%).  
- The top holdings are Reliance Industries (8%) and HDFC Bank (6%), making up 22% of liquid assets.  
- Unrealized gains are ₹5.2 million, or 33% of total assets.
```