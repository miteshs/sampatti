// The only path that leaves the device. Routes to Claude either through the hosted relay
// (default — the relay holds the key and stores nothing) or directly to Anthropic with the
// user's own key (BYO / "max privacy"). On desktop the call is made from Rust so the key
// never enters the webview; on web it streams over fetch.

import { isTauri, webByoKey } from "../platform";
import { useStore } from "../storage/store";

export const ANALYSIS_MODEL = "claude-opus-4-8";
export const EXTRACT_MODEL = "claude-sonnet-4-6";

export type Block =
  | { type: "text"; text: string }
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

// Stream a completion. Calls onText(delta) as chunks arrive; resolves with the full text.
export async function streamClaude(
  req: ClaudeRequest,
  onText?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { claudeMode, relayUrl } = useStore.getState().portfolio.settings;

  if (isTauri()) {
    return streamTauri(req, claudeMode, relayUrl, onText);
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
      try {
        const json = JSON.parse(data);
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          full += json.delta.text;
          onText?.(json.delta.text);
        }
      } catch {
        /* ignore keep-alives / non-JSON lines */
      }
    }
  }
  return full;
}

// Desktop: the Rust side decides relay-vs-byo, reads the keychain, and streams chunks back
// over a Channel so the key never touches JS.
async function streamTauri(
  req: ClaudeRequest, mode: string, relayUrl: string, onText?: (d: string) => void,
): Promise<string> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<string>();
  let full = "";
  channel.onmessage = (chunk) => {
    full += chunk;
    onText?.(chunk);
  };
  await invoke("claude_stream", { req, mode, relayUrl, onEvent: channel });
  return full;
}

// Non-streaming convenience (used by document extraction).
export async function callClaude(req: ClaudeRequest, signal?: AbortSignal): Promise<string> {
  return streamClaude(req, undefined, signal);
}
