# Local extraction eval — qwen3-4b-q4_k_m

2026-06-11 · model `Qwen3-4B-Q4_K_M.gguf` · 8 text fixtures (synthetic, scripts/eval/fixtures)

**Headline: 37/37 holdings matched (name + value ≤1%), 8/8 statement totals within 1%, 8/8 currencies right, median 7.8 tok/s.**

| fixture | holdings (got/want) | matched | value-off | missing | extra | total Δ% | ccy | type | units | cost | time | tok/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demat-equity.csv | 8/8 | 8 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 8/8 | 8/8 | 54s | 14.3 |
| bank-fd.csv | 4/4 | 4 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | — | — | 32s | 14.4 |
| mf-statement.xlsx | 6/6 | 6 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 6/6 | 6/6 | 66s | 11.1 |
| us-broker.xlsx | 5/5 | 5 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 5/5 | 5/5 | 111s | 4.5 |
| mf-statement.pdf | 6/6 | 6 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 6/6 | 6/6 | 119s | 6.3 |
| bank-fd.pdf | 4/4 | 4 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | — | — | 71s | 6.4 |
| pms-letter.pdf | 1/1 | 1 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | — | 1/1 | 31s | 5.9 |
| nps-statement.pdf | 3/3 | 3 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 3/3 | — | 50s | 7.8 |

- matched = name-matched holding with value within 1% of truth; value-off = right holding, wrong value
- extra = model holdings that match no ground-truth row (hallucination risk)
- every extraction lands in the review card — the floor is "annoying", never "silently wrong"

## On-device quick-take probe

quick-take: 73 words in 15s @ 8.6 tok/s; NO invented ₹-scale figures detected

```
- Net worth is ₹24.5 million, with total assets at ₹27 million and liabilities at ₹2.5 million.  
- 36% of assets are liquid, with ₹9.8 million in cash and equivalents.  
- The portfolio is heavily weighted in Indian equity (30%) and real estate (26%).  
- The top holdings are Reliance Industries (8%) and HDFC Bank (6%), making up 22% of liquid assets.  
- Unrealized gains are ₹5.2 million, or 33% of total assets.
```

long-prompt probe (≈3k tokens > n_batch): completed — decode chunking holds