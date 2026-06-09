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
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-app-token",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

    if (env.APP_TOKEN && request.headers.get("x-app-token") !== env.APP_TOKEN) {
      return json({ error: "unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }

    // Forward verbatim to Anthropic. We inject only the key + version; we never inspect,
    // rewrite, persist, or log the body.
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
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
