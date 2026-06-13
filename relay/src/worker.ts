// Sampatti relay — a stateless pass-through to the Anthropic API.
//
// It exists for ONE reason: so non-technical users don't need their own Anthropic key.
// It holds the key (as a Worker secret) and forwards each request to Claude, streaming the
// response straight back. It deliberately stores nothing and logs no request bodies.
//
// Privacy contract (see relay/README.md): no database, no KV, no request/response logging.
// The only thing that touches the portfolio brief is this in-memory forward.

export interface Env {
  ANTHROPIC_API_KEY: string;
  // Optional shared token so random callers can't burn your quota. If unset, no check.
  APP_TOKEN?: string;
  // Optional comma-separated list of short, human-shareable access codes (e.g. one per
  // friend, so any single code can be revoked without disturbing the others). Accepted
  // alongside APP_TOKEN. Set with: npx wrangler secret put APP_TOKENS
  APP_TOKENS?: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-app-token",
};

// The token in the distributed app is extractable, so the relay also caps what a request
// can cost: only the models the app uses, a hard output-token ceiling, and a body-size
// limit. These bound the blast radius if the token ever leaks — the budget cap on the
// Anthropic account is the final backstop.
const ALLOWED_MODELS = new Set([
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
]);
const MAX_OUTPUT_TOKENS = 8192; // the app asks for 4000; this just blocks abuse
const MAX_BODY_BYTES = 512 * 1024; // the brief is a few KB; reject anything huge

// Read the body with a hard byte cap enforced on the ACTUAL stream — the content-length
// header is client-controlled and can be omitted or spoofed, so it's only used as a
// fast-path reject. Returns null when the cap is exceeded.
export async function readBodyCapped(request: Request, cap: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

// Constant-time comparison so the token check can't be guessed byte-by-byte via timing.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The short, human-shareable access codes from APP_TOKENS: trimmed, blanks dropped, and
// upper-cased so a 6-char code a friend types is case-insensitive (a stray capital shouldn't
// lock them out). The legacy single APP_TOKEN is deliberately NOT in here — it's a long,
// high-entropy token, so it's matched case-SENSITIVELY in `authorized` (upper-casing it would
// fold distinct characters together and erode its entropy).
export function friendCodes(env: Env): string[] {
  return (env.APP_TOKENS ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0);
}

// True if the presented x-app-token is accepted. With neither APP_TOKEN nor APP_TOKENS set the
// relay is open (same as before). The legacy APP_TOKEN is compared case-sensitively at full
// entropy; the short friend codes are compared case-insensitively. Every candidate is checked
// with the constant-time compare and the loop never short-circuits, so timing leaks neither
// which credential matched nor how many exist.
export function authorized(presented: string, env: Env): boolean {
  const legacy = (env.APP_TOKEN ?? "").trim();
  const codes = friendCodes(env);
  if (!legacy && codes.length === 0) return true;
  const p = presented.trim();
  const pUpper = p.toUpperCase();
  let ok = false;
  if (legacy) ok = safeEqual(p, legacy) || ok; // case-sensitive — preserve the token's entropy
  for (const c of codes) ok = safeEqual(pUpper, c) || ok; // case-insensitive friend codes
  return ok;
}

export type SanitizeResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

// Validate and clamp the forwarded request before it reaches Anthropic. Pure + exported so
// it can be unit-tested without the Workers runtime.
export function sanitizeRequest(body: unknown): SanitizeResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.model !== "string" || !ALLOWED_MODELS.has(b.model)) {
    return { ok: false, status: 400, error: "model not allowed" };
  }
  if (typeof b.max_tokens !== "number" || !Number.isFinite(b.max_tokens) || b.max_tokens < 1) {
    return { ok: false, status: 400, error: "max_tokens required" };
  }
  // Clamp rather than reject so a slightly-high value never breaks the app.
  b.max_tokens = Math.min(Math.floor(b.max_tokens), MAX_OUTPUT_TOKENS);
  return { ok: true, body: b };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

    if (!authorized(request.headers.get("x-app-token") ?? "", env)) {
      return json({ error: "unauthorized" }, 401);
    }

    // Fast-path reject on the declared size, then enforce the cap on the real stream
    // (the header is client-controlled and proves nothing).
    const declaredLen = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
      return json({ error: "request too large" }, 413);
    }
    const text = await readBodyCapped(request, MAX_BODY_BYTES);
    if (text === null) return json({ error: "request too large" }, 413);

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }

    const check = sanitizeRequest(raw);
    if (!check.ok) return json({ error: check.error }, check.status);

    // Forward to Anthropic. We inject only the key + version; we never persist or log the
    // body, and we only mutated max_tokens (clamped) above.
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(check.body),
    });

    // Stream the (possibly SSE) response straight through, unbuffered.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS,
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  },
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
