# Local AI — design & build plan

**Goal:** AI that never leaves the device, as a per-task USER CHOICE. Claude stays the
quality tier; the local model is the privacy/offline/free tier. Nothing is hardwired:
each AI task routes through a configurable engine.

## Architecture

```
settings.ai = { extraction: "claude" | "local", analysis: "claude" | "local" }   (default: claude, claude)

src/ai/engine.ts          task → engine routing; ONE entry point per task. Components never
                          call transport.ts directly for AI work.
src-tauri/src/local_llm.rs  embedded llama.cpp (llama-cpp-2): model download (https +
                          host-pinned + sha256-verified, resumable), status, remove,
                          grammar-constrained streaming generation. No separate app, no
                          localhost server — inference runs in-process.
Privacy → "AI engines"    per-task pickers + model manager (download w/ progress, remove).
                          BEHIND Privacy → "Developer mode" (2026-06-11): the experimental
                          tier is invisible until that switch is flipped past a plain-words
                          risk notice; settings.developerMode=false forces engineFor →
                          "claude" regardless of settings.ai, and analysisReady honors the
                          same gate. Turning dev mode OFF resets settings.ai to claude/claude.
```

**Pinned model (v1)** — one model, verified, pluggable later:
- `Qwen/Qwen3-4B-GGUF` → `Qwen3-4B-Q4_K_M.gguf` · Apache-2.0 · 2,497,280,256 bytes
- sha256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`
- URL `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf`
- Stored at `<appdata>/models/`; "Remove model" on Privacy. Download allowed ONLY from
  huggingface.co over https with the exact sha — anything else refuses.

**Hard rules**
- Local generation makes ZERO network calls — enforced by contract tests (TS routing test:
  local extraction touches only the `local_generate` command and never `fetch`; source-scan:
  the generate path in `local_llm.rs` contains no http client usage).
- Images/screenshots stay on Claude (small VLMs aren't good enough for dense statements);
  the consent card says so when local is selected.
- Local analysis (when built) narrates ONLY the deterministic brief — it must never invent
  tax numbers; labeled "Quick take (on-device)".
- Quality floor: every local extraction lands in the same review card a human approves —
  a weak parse is annoying, never silently wrong.

## Build checklist (the /loop works through this top-to-bottom)

Phase 1 — extraction on-device
- [x] Pin model (repo/file/sha256/license) — 2026-06-11
- [x] Settings: `settings.ai` routing + defaults + load() migration + migration test
- [x] Rust `local_llm.rs`: status / download (progress channel, resume, sha256, host pin) / remove commands
- [x] Rust `local_generate`: llama-cpp-2 inference, JSON-grammar (GBNF) constrained, token streaming over Channel
- [x] `src/ai/engine.ts`: task routing; aiExtract goes through it; transport untouched for Claude path
- [x] Privacy "AI engines" card: pickers + model manager UI (progress, remove, size/license shown)
- [x] Consent-card flow: local+ready → text PDFs/unrecognized sheets parse locally with no "sent to Claude" warning; local+absent → offer download or Claude (one-shot `withExtractionEngine` override, setting untouched); images → Claude consent as today — pure `planBatch` matrix + component tests
- [x] Contract tests: no-network routing test + local_llm source-scan + settings migration
- [x] e2e: Privacy shows AI engines card; local chips gated off in web/CI; engine toggle persists across reload (smoke step; no model download in CI)
- [x] Docs: PRIVACY.md + testing.md + README note

Phase 2 — evaluation & confidence
- [x] Eval harness (`scripts/eval/`): `gen-fixtures.mjs` renders six synthetic Indian-statement
      archetypes (demat/MF/FD/PMS/US-broker/NPS) as CSV + XLSX + text-PDF + PNG with exact
      ground truth; `local-extract-eval.mjs` runs the app's exact prompt through the shipping
      `run_generate` (examples/local_eval) and scores holdings/total/currency/units/cost + tok/s
      → report-<label>.md (synthetic fixtures chosen over samples/ so the suite is committable
      and runs anywhere; samples/ stays a manual cross-check)
- [x] Tune extraction prompt/grammar from eval findings; document floor in this file
- [x] Model comparison: DECIDED for Qwen3-4B, without a scored 8B run — the attempt itself
      was the data. Loading Qwen3-8B-Q4_K_M (4.7GB, Metal full-offload via default model
      params) kernel-panicked this 8GB M2 Air mid-eval (watchdog timeout panic,
      2026-06-11 08:22 — "no checkins from watchdogd in 94 seconds"). The pin must serve
      exactly this hardware floor, and 4B is already at the eval ceiling (37/37 holdings,
      8/8 totals); a model that hard-crashes the audience's machines is disqualified
      regardless of quality. Revisit only behind Phase-4 hardware gating (RAM-aware tiers).
- [ ] Real-machine smoke: download model in-app, parse one real PDF locally end-to-end
      (engine-level proven by the eval binary on this machine; in-app click-through pending)

### Eval findings (2026-06-11, Apple silicon, Metal full-offload)

**Qwen3-4B-Q4_K_M (the pin): 37/37 holdings matched (name + value ≤1%), 8/8 statement totals
exact, 8/8 currencies right (incl. USD detection), 8/8 account types, units 28/28, cost
basis 26/26, median ~15 tok/s ≈ 16–50 s per statement.** Indian digit grouping
(1,08,31,366.11), folio tables, NPS scheme rows and PMS prose all parsed. Quick-take probe:
zero invented ₹-scale figures.

Real-inference bugs the harness caught on its FIRST run (each now fixed + regression-noted):
1. `llama_sampler_sample` already accepts into the chain — our extra `accept()` corrupted the
   GBNF state and aborted the process when the grammar completed.
2. ggml-metal static teardown aborts if model buffers are alive at exit → `unload_engine()`
   on `RunEvent::Exit` (the app would have shown "quit unexpectedly" after local AI use).
3. Qwen3 thinking mode: text generation burned the whole budget on `<think>` — fixed with the
   canonical empty-think prefill (JSON mode was immune: the grammar forbids think-tokens).
4. (Caught live in-app, 2026-06-11, NOT by the suite) `llama_decode` ABORTS the process on any
   batch over n_batch (2048 tokens) — the analysis prompt (persona + brief + chat history)
   crossed the line; every eval fixture happened to sit under it. Prompt now decodes in
   1024-token chunks, generation is clamped to the remaining context budget, and an
   over-long prompt returns a normal Err (UI message) instead of killing the app. The
   `--analysis` run now carries a long-prompt probe so this can't regress silently.

Prompt tuning from findings: holdings/values needed NONE (37/37 before any tuning).
account_type took two iterations — whack-a-mole that only full-suite re-runs catch:
(1) the institution-over-instruments rule (bank FDs = "bank", USD brokerage =
"foreign_broker") fixed the three bank/US-broker ✗ cells but flipped the PMS letter to
"mutual_fund" (its new "fund house" example swallowed the PMS firm); (2) adding a
PMS/AIF example to the same rule fixed that — the table is now ✓ across the board.
The floor: a weak parse surfaces in the review card as an odd account_type chip — never
a wrong number.

Phase 3 — more local-AI use cases (cheap wins on the same engine)
- [ ] CSV header-mapping suggester: unrecognized columns → proposed mapping (text-only, tiny
      prompt, lands in the existing NeedsClaude flow as a local option)
- [ ] Asset-class tie-breaker for "other"-classified holdings (review-card suggestion chip)
- [ ] "Quick take (on-device)": local analysis narrating the deterministic brief + verdicts,
      clearly labeled; Claude remains the deep review
- [ ] Evaluate a local embedding model for portfolio search (design note first)

Phase 4 — hardening
- [ ] Hardware gating: RAM/arch detection; expectation copy ("~40s/statement on older laptops");
      gate any future model download/load by physical RAM vs model size — the 8B comparison
      attempt proved an oversized model does NOT degrade gracefully, it kernel-panics the OS
- [ ] Model updates: version the pin; migration when the pin changes (old file removed)
- [ ] Windows CI: llama.cpp build time budget; consider cargo feature if it hurts

## Decisions log
- Embedded llama.cpp over Ollama: no second app for non-technical users; no localhost server
  surface. Ollama may later be an optional power-user backend behind the same engine API.
- Qwen3-4B over Llama-3.2-3B/Phi-4-mini: Apache-2.0, strong multilingual (Indian scheme
  names), good constrained-JSON behavior. Revisit at Phase 2 with eval data.
- Generic JSON grammar (llama.cpp json.gbnf) over full schema-grammar for v1:
  `extractJson` repair + `validateDrafts` tolerance already absorb shape drift.
