import { describe, it, expect } from "vitest";
import { sanitizeRequest, safeEqual } from "./worker";

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
