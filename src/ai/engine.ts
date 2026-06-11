// AI engine routing — the ONE place that decides whether an AI task runs on Claude or on
// the embedded local model. Components never import transport.ts for AI work directly;
// they ask for a task and the user's per-task setting (Privacy → AI engines) decides.
//
// Hard rule (contract-tested): the local path touches ONLY the `local_*` Tauri commands —
// never fetch, never the relay. That is the whole point of the local tier.

import { useStore } from "../storage/store";
import { callClaude, streamClaude, EXTRACT_MODEL, type ClaudeRequest } from "../claude/transport";
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

export interface LocalModelStatus {
  state: "absent" | "partial" | "ready";
  size_bytes: number;
  expected_bytes: number;
  license: string;
}

export async function localModelStatus(): Promise<LocalModelStatus> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LocalModelStatus>("local_model_status");
}

export async function localModelRemove(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("local_model_remove");
}

export async function localModelDownload(onProgress: (received: number, total: number) => void): Promise<void> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<{ received: number; total: number }>();
  channel.onmessage = (m) => onProgress(m.received, m.total);
  await invoke("local_model_download", { onProgress: channel });
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
    prompt,
    jsonMode: opts.jsonMode,
    maxTokens: opts.maxTokens,
    onToken: channel,
  });
  return full;
}

// Statement-extraction text completion. Local mode is grammar-constrained to valid JSON;
// the caller's extractJson/validateDrafts pipeline shapes and verifies either way.
export async function generateForExtraction(promptText: string): Promise<string> {
  if (engineFor("extraction") === "local") {
    return localGenerate(promptText, { jsonMode: true, maxTokens: 4000 });
  }
  return callClaude({
    model: EXTRACT_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
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
