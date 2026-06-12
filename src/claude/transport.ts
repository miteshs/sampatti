// The only path that leaves the device. Routes to Claude either through the hosted relay
// (default — the relay holds the key and stores nothing) or directly to Anthropic with the
// user's own key (BYO / "max privacy"). On desktop the call is made from Rust so the key
// never enters the webview; on web it streams over fetch.

import { isTauri, keyStoreName, webByoKey } from "../platform";
import { useStore } from "../storage/store";

// Statement extraction runs cheapest-first: try Haiku, escalate to Sonnet only when the
// cheap pass comes back empty or unparseable (see ingest/aiExtract.ts). Output tokens
// dominate extraction cost, so the cheap first pass is where the saving lives.
export const EXTRACT_MODEL_CHEAP = "claude-haiku-4-5";
export const EXTRACT_MODEL_STRONG = "claude-sonnet-4-6";

// User-selectable analysis model (cost vs. quality). Approx cost is for one analysis;
// output tokens dominate, so the model choice is the real cost lever. Labels speak to a
// non-technical user; the hint carries the model name for those who care.
export const ANALYSIS_MODELS = [
  { id: "claude-opus-4-8", label: "Most thorough", hint: "Opus · strongest on tax nuance · ~$0.10/analysis" },
  { id: "claude-sonnet-4-6", label: "Balanced — recommended", hint: "Sonnet · great quality at a fair price · ~$0.06" },
  { id: "claude-haiku-4-5", label: "Quickest", hint: "Haiku · lighter reasoning, lowest cost · ~$0.02" },
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

// The x-app-token sent in relay mode. A user-entered relay code (shared by whoever runs the
// relay) takes precedence over the build-time token — so a public/token-less build can use a
// friend's relay by pasting the code they gave out. Blank/whitespace → fall back to the build
// token; if neither is set, returns "" and no header is sent. Exported for tests.
export function effectiveAppToken(relayCode: string | undefined, buildToken: string): string {
  return (relayCode ?? "").trim() || buildToken;
}

// Public builds ship WITHOUT the relay token (so strangers can't spend the relay owner's API
// credits) — a relay 401/403 then just means "this build has no hosted access": point the
// user at the BYO-key path instead of showing a bare status code.
// Exported for tests.
export function relayHint(mode: string, message: string): Error {
  if (mode === "relay" && /\(40[13][^)]*\)/.test(message)) {
    const where = isTauri() ? `it stays in the ${keyStoreName()}` : "it stays on this device";
    return new Error(
      `${message} — this build doesn't include hosted-relay access. Add your own Anthropic API key on the Settings tab (⚙) (${where}), or set your own relay URL.`,
    );
  }
  return new Error(message);
}

// Stream a completion. Calls onText(delta) as chunks arrive; resolves with the full text.
export async function streamClaude(
  req: ClaudeRequest,
  onText?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { claudeMode, relayUrl, relayCode } = useStore.getState().portfolio.settings;
  const appToken = effectiveAppToken(relayCode, RELAY_TOKEN);

  if (isTauri()) {
    try {
      return await streamTauri(req, claudeMode, relayUrl, appToken, onText);
    } catch (e) {
      throw relayHint(claudeMode, e instanceof Error ? e.message : String(e));
    }
  }

  // ---- web: relay or direct-to-Anthropic ----
  let url: string;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (claudeMode === "byo") {
    const key = webByoKey();
    if (!key) throw new Error("No Anthropic key set. Add one on the Settings tab (⚙), or switch to relay mode.");
    url = ANTHROPIC_URL;
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    url = relayUrl;
    if (appToken) headers["x-app-token"] = appToken;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...req, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw relayHint(claudeMode, `Claude request failed (${res.status}). ${detail.slice(0, 300)}`);
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
