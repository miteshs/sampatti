// AI engine routing — the ONE place that decides whether an AI task runs on Claude or on
// the embedded local model. Components never import transport.ts for AI work directly;
// they ask for a task and the user's per-task setting (Settings → AI engines) decides.
//
// Hard rule (contract-tested): the local path touches ONLY the `local_*` Tauri commands —
// never fetch, never the relay. That is the whole point of the local tier.

import { useStore } from "../storage/store";
import { callClaude, streamClaude, type ClaudeRequest } from "../claude/transport";
import { isTauri } from "../platform";
import type { AiEngine } from "../domain/types";

export type AiTask = "extraction" | "analysis";

// One-shot batch override — "use Claude just this once" when the local model isn't
// downloaded (the saved setting is never touched). Scoped: set for the duration of one
// batch's promise chain, always restored, even when the batch throws.
let extractionOverride: AiEngine | null = null;

export async function withExtractionEngine<T>(engine: AiEngine, fn: () => Promise<T>): Promise<T> {
  const prev = extractionOverride;
  extractionOverride = engine;
  try {
    return await fn();
  } finally {
    extractionOverride = prev;
  }
}

export function engineFor(task: AiTask): AiEngine {
  // The embedded model only exists inside the desktop shell; the web preview always Claude.
  if (!isTauri()) return "claude";
  const s = useStore.getState().portfolio.settings;
  // The on-device tier is experimental and sits behind Developer mode: off means Claude,
  // no matter what settings.ai says (the saved choice survives for re-enabling).
  if (!s.developerMode) return "claude";
  if (task === "extraction" && extractionOverride) return extractionOverride;
  return task === "extraction" ? s.ai.extraction : s.ai.analysis;
}

// ---- local model lifecycle (thin wrappers over the Rust commands) ------------

// The on-device model the local engine should use, from settings — falls back to the registry
// default when unset (older save files / first run). Kept in sync with DEFAULT_MODEL_ID in
// src-tauri/src/local_llm.rs.
export const DEFAULT_LOCAL_MODEL = "gemma-4-e4b";
export function selectedLocalModel(): string {
  return useStore.getState().portfolio.settings.ai.localModel ?? DEFAULT_LOCAL_MODEL;
}

export interface LocalModelInfo {
  id: string;
  display_name: string;
  state: "absent" | "partial" | "ready";
  size_bytes: number;
  expected_bytes: number;
  license: string;
}

// The whole registry + each model's on-disk state — drives the Settings picker.
export async function localModelsList(): Promise<LocalModelInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LocalModelInfo[]>("local_models_list");
}

// Whether the currently-selected on-device model is downloaded and usable — the gate the
// import flow checks before routing extraction locally.
export async function localModelReady(): Promise<boolean> {
  const id = selectedLocalModel();
  const models = await localModelsList();
  return models.some((m) => m.id === id && m.state === "ready");
}

export async function localModelRemove(modelId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("local_model_remove", { modelId });
}

export async function localModelDownload(
  modelId: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<{ received: number; total: number }>();
  channel.onmessage = (m) => onProgress(m.received, m.total);
  await invoke("local_model_download", { modelId, onProgress: channel });
}

// ---- generation ---------------------------------------------------------------

export async function localGenerate(
  prompt: string,
  opts: { jsonMode: boolean; maxTokens: number },
  onText?: (delta: string) => void,
): Promise<string> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<string>();
  let full = "";
  channel.onmessage = (piece) => {
    full += piece;
    onText?.(piece);
  };
  await invoke("local_generate", {
    modelId: selectedLocalModel(),
    prompt,
    jsonMode: opts.jsonMode,
    maxTokens: opts.maxTokens,
    onToken: channel,
  });
  return full;
}

// Statement-extraction text completion. Local mode is grammar-constrained to valid JSON;
// the caller's extractJson/validateDrafts pipeline shapes and verifies either way. On the
// Claude path the static prompt is sent as its own cache_control block, so a batch of
// statements re-reads it at ~10% input cost; `model` lets the caller pick the cheap/strong
// tier (aiExtract.ts escalates Haiku → Sonnet). Local ignores the Claude `model` tier — it runs
// the user's selected on-device model (settings.ai.localModel).
export async function generateForExtraction(
  staticPrompt: string,
  statement: string,
  model: string,
): Promise<string> {
  if (engineFor("extraction") === "local") {
    return localGenerate(`${staticPrompt}\n\n--- STATEMENT TEXT ---\n${statement}`, { jsonMode: true, maxTokens: 4000 });
  }
  return callClaude({
    model,
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: staticPrompt, cache_control: { type: "ephemeral" } },
          { type: "text", text: `--- STATEMENT TEXT ---\n${statement}` },
        ],
      },
    ],
  });
}

// Analysis/chat streaming. Local mode flattens the request into a single prompt and is the
// "Quick take (on-device)" tier — it narrates the deterministic brief; Claude stays the
// deep-review tier.
export async function streamAnalysis(
  req: ClaudeRequest,
  onText?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (engineFor("analysis") === "local") {
    const parts: string[] = [];
    if (req.system) parts.push(req.system);
    for (const m of req.messages) {
      const text = typeof m.content === "string"
        ? m.content
        : m.content.map((b) => (b.type === "text" ? b.text : "[image omitted on-device]")).join("\n");
      parts.push(`${m.role === "user" ? "User" : "Assistant"}: ${text}`);
    }
    parts.push(
      "Note: you are the on-device quick-take model. Use ONLY the numbers present in the brief above — never invent figures or tax rules. Keep it short and plain.",
    );
    return localGenerate(parts.join("\n\n"), { jsonMode: false, maxTokens: req.max_tokens }, onText);
  }
  return streamClaude(req, onText, signal);
}
