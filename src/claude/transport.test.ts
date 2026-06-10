// relayHint turns a bare relay 401/403 into "this public build has no hosted access — add
// your own key" guidance. It must name the RIGHT key store per platform, fire only for
// relay-mode auth failures, and leave every other error untouched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { relayHint } from "./transport";

const tauriWindow = () => vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });

afterEach(() => vi.unstubAllGlobals());

describe("relayHint", () => {
  it("decorates a relay 401 with the BYO-key hint", () => {
    const e = relayHint("relay", "Claude request failed (401). ");
    expect(e.message).toContain("doesn't include hosted-relay access");
    expect(e.message).toContain("Privacy screen");
  });

  it("decorates a relay 403, including Rust-style status text", () => {
    // The desktop error path formats the status as e.g. "(403 Forbidden)".
    const e = relayHint("relay", "Claude request failed (403 Forbidden). nope");
    expect(e.message).toContain("doesn't include hosted-relay access");
  });

  it("names the Windows Credential Manager on a Windows desktop build", () => {
    tauriWindow();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130" });
    const e = relayHint("relay", "Claude request failed (401). ");
    expect(e.message).toContain("Windows Credential Manager");
    expect(e.message).not.toContain("Keychain");
  });

  it("names the macOS Keychain on a Mac desktop build", () => {
    tauriWindow();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    const e = relayHint("relay", "Claude request failed (401). ");
    expect(e.message).toContain("macOS Keychain");
  });

  it("on the web preview, points at this device without naming a store", () => {
    const e = relayHint("relay", "Claude request failed (401). ");
    expect(e.message).toContain("it stays on this device");
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
