// relayHint turns a bare relay 401/403 into "this public build has no hosted access — add
// your own key" guidance. It must name the RIGHT key store per platform, fire only for
// relay-mode auth failures, and leave every other error untouched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveAppToken, relayHint } from "./transport";

afterEach(() => vi.unstubAllGlobals());

describe("relayHint", () => {
  it("decorates a relay 401 with the friendly access-code prompt", () => {
    const e = relayHint("relay", "Claude request failed (401). ");
    expect(e.message).toContain("AI access code is missing");
    expect(e.message).toContain("ask the developer");
  });

  it("decorates a relay 403 with the friendly access-code prompt", () => {
    const e = relayHint("relay", "Claude request failed (403 Forbidden). nope");
    expect(e.message).toContain("AI access code is missing");
  });

  it("leaves non-auth relay errors alone", () => {
    const msg = "Claude request failed (500). upstream";
    expect(relayHint("relay", msg).message).toBe(msg);
  });

  it("leaves BYO-mode auth errors alone (a 401 there means a bad user key)", () => {
    const msg = "Claude request failed (401). invalid x-api-key";
    expect(relayHint("byo", msg).message).toBe(msg);
  });

  it("does not fire on a 404 or on 401 appearing mid-text", () => {
    const notFound = "Claude request failed (404). no such route";
    expect(relayHint("relay", notFound).message).toBe(notFound);
    const midText = "stream cut after 401 bytes";
    expect(relayHint("relay", midText).message).toBe(midText);
  });
});

// Relay access is ONLY the user-entered access code — nothing is baked into the build. The
// code is sent as x-app-token; blank/whitespace/unset → "" so no header goes out and the relay
// rejects the code-less request.
describe("effectiveAppToken — user access code only", () => {
  it("uses the user-entered code when present", () => {
    expect(effectiveAppToken("friend-code")).toBe("friend-code");
  });

  it("trims the entered code", () => {
    expect(effectiveAppToken("  abc  ")).toBe("abc");
  });

  it("is empty (so no x-app-token header is sent) when blank, whitespace, or unset", () => {
    expect(effectiveAppToken("")).toBe("");
    expect(effectiveAppToken("   ")).toBe("");
    expect(effectiveAppToken(undefined)).toBe("");
  });
});
