# Local extraction eval — qwen3-4b-q4_k_m

2026-06-11 · model `Qwen3-4B-Q4_K_M.gguf` · 1 text fixtures (synthetic, scripts/eval/fixtures)

**Headline: 0/0 holdings matched (name + value ≤1%), 0/0 statement totals within 1%, 0/0 currencies right, median ? tok/s.**

| fixture | holdings (got/want) | matched | value-off | missing | extra | total Δ% | ccy | type | units | cost | time | tok/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bank-fd.csv | — | — | — | — | — | — | — | — | — | — | 28s | ERROR: ggml_metal_device_init: tensor API disabled for pre-M5 and pre-A19 devices
ggml_ |

- matched = name-matched holding with value within 1% of truth; value-off = right holding, wrong value
- extra = model holdings that match no ground-truth row (hallucination risk)
- every extraction lands in the review card — the floor is "annoying", never "silently wrong"