// The only path that leaves the device. Routes to Claude either through the hosted relay
// (default — the relay holds the key and stores nothing) or directly to Anthropic with the
// user's own key (BYO / "max privacy"). On desktop the call is made from Rust so the key
// never enters the webview; on web it streams over fetch.

import { isTauri, webByoKey } from "../platform";
import { useStore } from "../storage/store";

export const EXTRACT_MODEL = "claude-sonnet-4-6";

// User-selectable analysis model (cost vs. quality). Approx cost is for one analysis;
// output tokens dominate, so the model choice is the real cost lever.
export const ANALYSIS_MODELS = [
  { id: "claude-opus-4-8", label: "Opus 4.8", hint: "Best quality (esp. India tax) · ~$0.10/analysis" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", hint: "Balanced — recommended · ~$0.06" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Cheapest, lighter reasoning · ~$0.02" },
] as const;

export type Block =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface Msg {
  role: "user" | "assistant";
  content: string | Block[];
}

export interface ClaudeRequest {
  model: string;
  system?: string;
  max_tokens: number;
  messages: Msg[];
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Shared token sent to the relay as `x-app-token`, matching the worker's APP_TOKEN secret.
// Baked in at build time from .env.local (gitignored). Lets the relay owner revoke access
// by rotating the secret. Only used in relay mode; BYO talks to Anthropic directly.
const RELAY_TOKEN = import.meta.env.VITE_RELAY_TOKEN ?? "";

// Stream a completion. Calls onText(delta) as chunks arrive; resolves with the full text.
export async function streamClaude(
  req: ClaudeRequest,
  onText?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { claudeMode, relayUrl } = useStore.getState().portfolio.settings;

  if (isTauri()) {
    return streamTauri(req, claudeMode, relayUrl, RELAY_TOKEN, onText);
  }

  // ---- web: relay or direct-to-Anthropic ----
  let url: string;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (claudeMode === "byo") {
    const key = webByoKey();
    if (!key) throw new Error("No Anthropic key set. Add one on the Privacy screen, or switch to relay mode.");
    url = ANTHROPIC_URL;
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    url = relayUrl;
    if (RELAY_TOKEN) headers["x-app-token"] = RELAY_TOKEN;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...req, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude request failed (${res.status}). ${detail.slice(0, 300)}`);
  }
  return parseSse(res.body, onText);
}

// Parse the Anthropic SSE stream, extracting text deltas. Both relay and direct use this
// (the relay passes Anthropic's stream through unchanged).
async function parseSse(body: ReadableStream<Uint8Array>, onText?: (d: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const ev of events) {
      const line = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
      try {
        json = JSON.parse(data);
      } catch {
        continue; // keep-alive / non-JSON line
      }
      // Surface a mid-stream error event instead of ending with a silently truncated reply.
      if (json.type === "error") {
        throw new Error(`Claude stream error: ${json.error?.message ?? "unknown"}`);
      }
      if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
        full += json.delta.text ?? "";
        onText?.(json.delta.text ?? "");
      }
    }
  }
  return full;
}

// Desktop: the Rust side decides relay-vs-byo, reads the keychain, and streams chunks back
// over a Channel so the key never touches JS.
async function streamTauri(
  req: ClaudeRequest, mode: string, relayUrl: string, appToken: string, onText?: (d: string) => void,
): Promise<string> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<string>();
  let full = "";
  channel.onmessage = (chunk) => {
    full += chunk;
    onText?.(chunk);
  };
  await invoke("claude_stream", { req, mode, relayUrl, appToken, onEvent: channel });
  return full;
}

// Non-streaming convenience (used by document extraction).
export async function callClaude(req: ClaudeRequest, signal?: AbortSignal): Promise<string> {
  return streamClaude(req, undefined, signal);
}
