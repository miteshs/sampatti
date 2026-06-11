# Local extraction eval — qwen3-4b-q4_k_m

2026-06-11 · model `Qwen3-4B-Q4_K_M.gguf` · 8 text fixtures (synthetic, scripts/eval/fixtures)

**Headline: 37/37 holdings matched (name + value ≤1%), 8/8 statement totals within 1%, 8/8 currencies right, median 14.4 tok/s.**

| fixture | holdings (got/want) | matched | value-off | missing | extra | total Δ% | ccy | type | units | cost | time | tok/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| demat-equity.csv | 8/8 | 8 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 8/8 | 8/8 | 54s | 14.1 |
| bank-fd.csv | 4/4 | 4 | 0 | 0 | 0 | 0.00 | ✓ | ✗ | — | — | 32s | 15.1 |
| mf-statement.xlsx | 6/6 | 6 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 6/6 | 6/6 | 42s | 15.5 |
| us-broker.xlsx | 5/5 | 5 | 0 | 0 | 0 | 0.00 | ✓ | ✗ | 5/5 | 5/5 | 35s | 14.4 |
| mf-statement.pdf | 6/6 | 6 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 6/6 | 6/6 | 50s | 14.8 |
| bank-fd.pdf | 4/4 | 4 | 0 | 0 | 0 | 0.00 | ✓ | ✗ | — | — | 34s | 13.9 |
| pms-letter.pdf | 1/1 | 1 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | — | 1/1 | 17s | 11.1 |
| nps-statement.pdf | 3/3 | 3 | 0 | 0 | 0 | 0.00 | ✓ | ✓ | 3/3 | — | 28s | 14.1 |

- matched = name-matched holding with value within 1% of truth; value-off = right holding, wrong value
- extra = model holdings that match no ground-truth row (hallucination risk)
- every extraction lands in the review card — the floor is "annoying", never "silently wrong"

## On-device quick-take probe

quick-take: 464 words in 30s @ 23.8 tok/s; NO invented ₹-scale figures detected

```
<think>
Okay, let's see. The user wants a short review of this portfolio brief. They specified 5 bullet points max, so I need to be concise.

First, the net worth is 24.5 million INR, and total assets are 27 million. That's a good start. The net worth is a bit lower than total assets, which is normal because of liabilities. The liabilities are 2.5 million, which is 10% of the total assets. That's a manageable amount.

Next, the liquid assets are 9.8 million, which is 36% of total assets. That's a decent liquidity position, but maybe the user should check if they have enough cash reserves. The concentration of liquid assets is 22% in the largest, and 61% in the top 5. That's a bit high, so maybe diversification is needed.

Looking at the allocation by class, Indian equity is 30%, Equity MF 24%, real estate 26%, EPF/PPF 12%, and gold 8%. The real estate is the largest chunk, which is 26%. That's a significant portion. Maybe the user should consider if real estate is the right allocation for their risk tolerance.

The HHI is 1240, which is a measure of concentration. A higher HHI means more concentration. The top holdings are Reliance and HDFC Bank, each 8% and 6%. That's a bit high, so the portfolio might be over-concentrated in a few stocks. The user might need to spread out more to reduce risk.

The gains section shows total cost basis 15.6 million and unrealized gain 5.2 million, which is 33% of the assets. That's a good gain, but the user should monitor if the unrealized gains are sustainable. Also, the tax wrappers: taxable is 18.2 million, exempt is 3.3 million, and nps is zero. So the taxable portion is a big chunk, which might affect their tax planning.

Wait, the user is an Indian financial analyst, so tax rules are important. The taxable is 18.2 million, which i
```