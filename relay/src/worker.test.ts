import { describe, it, expect } from "vitest";
import worker, { authorized, readBodyCapped, sanitizeRequest, safeEqual, validCodes, type Env } from "./worker";

describe("safeEqual (constant-time token compare)", () => {
  it("matches identical tokens", () => {
    expect(safeEqual("spt_abc123", "spt_abc123")).toBe(true);
  });
  it("rejects a one-character difference", () => {
    expect(safeEqual("spt_abc123", "spt_abc124")).toBe(false);
  });
  it("rejects different lengths", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("rejects empty against a set token", () => {
    expect(safeEqual("", "token")).toBe(false);
  });
});

describe("sanitizeRequest (cost-abuse guard)", () => {
  const base = { model: "claude-haiku-4-5", max_tokens: 4000, messages: [] };

  it("passes a normal app request through unchanged", () => {
    const r = sanitizeRequest({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.max_tokens).toBe(4000);
  });

  it("clamps an oversized max_tokens to the ceiling", () => {
    const r = sanitizeRequest({ ...base, max_tokens: 64000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.max_tokens).toBe(8192);
  });

  it("accepts every model the app offers", () => {
    for (const model of ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
      expect(sanitizeRequest({ ...base, model }).ok).toBe(true);
    }
  });

  it("rejects a model not on the allowlist", () => {
    const r = sanitizeRequest({ ...base, model: "claude-opus-4-8-ultra-expensive" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects non-object bodies", () => {
    expect(sanitizeRequest(null).ok).toBe(false);
    expect(sanitizeRequest([]).ok).toBe(false);
    expect(sanitizeRequest("not json").ok).toBe(false);
  });

  it("requires a numeric max_tokens", () => {
    expect(sanitizeRequest({ model: "claude-haiku-4-5" }).ok).toBe(false);
    expect(sanitizeRequest({ ...base, max_tokens: Infinity }).ok).toBe(false);
    expect(sanitizeRequest({ ...base, max_tokens: -5 }).ok).toBe(false);
  });
});

describe("readBodyCapped (real-stream body limit)", () => {
  const req = (body: string) => new Request("https://relay.test/", { method: "POST", body });

  it("returns the body when under the cap", async () => {
    expect(await readBodyCapped(req('{"a":1}'), 1024)).toBe('{"a":1}');
  });

  it("returns null when the actual bytes exceed the cap (regardless of headers)", async () => {
    expect(await readBodyCapped(req("x".repeat(2048)), 1024)).toBeNull();
  });

  it("treats a missing body as empty", async () => {
    expect(await readBodyCapped(new Request("https://relay.test/", { method: "POST" }), 1024)).toBe("");
  });
});

// The APP_TOKEN gate is the security boundary friends rely on. These drive the real fetch
// handler. An INVALID body ({}) is used throughout so a request that passes the gate stops at
// validation (400) — it never forwards to Anthropic, so no test spends Claude credits.
describe("APP_TOKEN gate (fetch handler)", () => {
  const env = (extra: Partial<Env> = {}): Env => ({ ANTHROPIC_API_KEY: "sk-test", ...extra });
  const post = (headers: Record<string, string> = {}) =>
    new Request("https://relay.test/", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}", // invalid app request → 400 at validation, never reaches Anthropic
    });

  it("401s when APP_TOKEN is set but no x-app-token is sent", async () => {
    const res = await worker.fetch(post(), env({ APP_TOKEN: "secret" }));
    expect(res.status).toBe(401);
  });

  it("401s when APP_TOKEN is set and the wrong token is sent", async () => {
    const res = await worker.fetch(post({ "x-app-token": "wrong" }), env({ APP_TOKEN: "secret" }));
    expect(res.status).toBe(401);
  });

  it("passes the gate with the correct token (then 400 on the bad body — not 401)", async () => {
    const res = await worker.fetch(post({ "x-app-token": "secret" }), env({ APP_TOKEN: "secret" }));
    expect(res.status).toBe(400);
  });

  it("is OPEN when APP_TOKEN is unset — any caller passes the gate (footgun guard)", async () => {
    const res = await worker.fetch(post(), env()); // no APP_TOKEN configured
    expect(res.status).toBe(400); // reached validation, i.e. NOT rejected as unauthorized
    expect(res.status).not.toBe(401);
  });

  it("a one-char-off token is rejected (constant-time compare wired into the handler)", async () => {
    const res = await worker.fetch(post({ "x-app-token": "secret1" }), env({ APP_TOKEN: "secret" }));
    expect(res.status).toBe(401);
  });

  it("does not gate the CORS preflight (OPTIONS) even with APP_TOKEN set", async () => {
    const res = await worker.fetch(new Request("https://relay.test/", { method: "OPTIONS" }), env({ APP_TOKEN: "secret" }));
    expect(res.status).not.toBe(401);
  });

  it("rejects a non-POST method with 405 before forwarding", async () => {
    const res = await worker.fetch(new Request("https://relay.test/", { method: "GET" }), env({ APP_TOKEN: "secret" }));
    expect(res.status).toBe(405);
  });
});

describe("validCodes / authorized (short per-friend access codes)", () => {
  it("parses APP_TOKENS into a trimmed, upper-cased, blank-free list", () => {
    expect(validCodes({ ANTHROPIC_API_KEY: "k", APP_TOKENS: "abc123, def456 ,, ghi789" }))
      .toEqual(["ABC123", "DEF456", "GHI789"]);
  });

  it("includes the legacy APP_TOKEN alongside APP_TOKENS", () => {
    expect(validCodes({ ANTHROPIC_API_KEY: "k", APP_TOKEN: "long-legacy", APP_TOKENS: "abc123" }))
      .toEqual(["LONG-LEGACY", "ABC123"]);
  });

  it("is empty when neither is set (→ open relay)", () => {
    expect(validCodes({ ANTHROPIC_API_KEY: "k" })).toEqual([]);
  });

  it("accepts a code that matches any entry, case-insensitively and trimmed", () => {
    const codes = validCodes({ ANTHROPIC_API_KEY: "k", APP_TOKENS: "ABC123,DEF456" });
    expect(authorized("def456", codes)).toBe(true);   // lower-case friend typed
    expect(authorized("  ABC123  ", codes)).toBe(true); // stray whitespace
    expect(authorized("XYZ999", codes)).toBe(false);   // unknown code
  });

  it("is open (accepts anything, even empty) when no codes are configured", () => {
    expect(authorized("", [])).toBe(true);
    expect(authorized("whatever", [])).toBe(true);
  });
});

describe("APP_TOKENS gate (fetch handler, end to end)", () => {
  const post = (headers: Record<string, string> = {}) =>
    new Request("https://relay.test/", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });

  it("accepts a friend's code from the APP_TOKENS list (past the gate → 400 on bad body)", async () => {
    const env: Env = { ANTHROPIC_API_KEY: "sk-test", APP_TOKENS: "ABC123,DEF456" };
    expect((await worker.fetch(post({ "x-app-token": "abc123" }), env)).status).toBe(400);
  });

  it("rejects a code not in the list", async () => {
    const env: Env = { ANTHROPIC_API_KEY: "sk-test", APP_TOKENS: "ABC123,DEF456" };
    expect((await worker.fetch(post({ "x-app-token": "nope12" }), env)).status).toBe(401);
  });

  it("still accepts the legacy single APP_TOKEN when both are set", async () => {
    const env: Env = { ANTHROPIC_API_KEY: "sk-test", APP_TOKEN: "spt_legacy", APP_TOKENS: "ABC123" };
    expect((await worker.fetch(post({ "x-app-token": "spt_legacy" }), env)).status).toBe(400);
    expect((await worker.fetch(post({ "x-app-token": "ABC123" }), env)).status).toBe(400);
  });
});
