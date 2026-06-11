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
- [ ] e2e: Privacy shows AI engines card; engine toggle persists (no model download in CI)
- [x] Docs: PRIVACY.md + testing.md + README note

Phase 2 — evaluation & confidence
- [ ] `scripts/eval/local-extract-eval.mjs`: feed TEXT of deterministically-parsed real statements
      (samples/, ground truth = the deterministic parser output) through the local engine;
      score holdings-count / total-value / per-field accuracy; markdown report
- [ ] Tune extraction prompt/grammar from eval findings; document floor in this file
- [ ] Real-machine smoke: download model in-app, parse one real PDF locally end-to-end

Phase 3 — more local-AI use cases (cheap wins on the same engine)
- [ ] CSV header-mapping suggester: unrecognized columns → proposed mapping (text-only, tiny
      prompt, lands in the existing NeedsClaude flow as a local option)
- [ ] Asset-class tie-breaker for "other"-classified holdings (review-card suggestion chip)
- [ ] "Quick take (on-device)": local analysis narrating the deterministic brief + verdicts,
      clearly labeled; Claude remains the deep review
- [ ] Evaluate a local embedding model for portfolio search (design note first)

Phase 4 — hardening
- [ ] Hardware gating: RAM/arch detection; expectation copy ("~40s/statement on older laptops")
- [ ] Model updates: version the pin; migration when the pin changes (old file removed)
- [ ] Windows CI: llama.cpp build time budget; consider cargo feature if it hurts

## Decisions log
- Embedded llama.cpp over Ollama: no second app for non-technical users; no localhost server
  surface. Ollama may later be an optional power-user backend behind the same engine API.
- Qwen3-4B over Llama-3.2-3B/Phi-4-mini: Apache-2.0, strong multilingual (Indian scheme
  names), good constrained-JSON behavior. Revisit at Phase 2 with eval data.
- Generic JSON grammar (llama.cpp json.gbnf) over full schema-grammar for v1:
  `extractJson` repair + `validateDrafts` tolerance already absorb shape drift.
