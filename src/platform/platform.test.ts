// The OS-copy helpers drive every place the UI names the key store ("macOS Keychain" vs
// "Windows Credential Manager") and the disk-encryption advice — get these wrong and the
// Privacy screen lies to Windows users about where their key lives.
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectOS, diskEncryption, keyStoreName, storageLocation } from "./index";

// Real-world UA strings from the two webviews Tauri uses, plus a Linux one.
const UA = {
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68",
  macos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)",
};

const stubUA = (ua: string) => vi.stubGlobal("navigator", { userAgent: ua });

afterEach(() => vi.unstubAllGlobals());

describe("detectOS", () => {
  it("recognises WebView2 (Windows)", () => {
    stubUA(UA.windows);
    expect(detectOS()).toBe("windows");
  });

  it("recognises WKWebView (macOS)", () => {
    stubUA(UA.macos);
    expect(detectOS()).toBe("macos");
  });

  it("falls back to linux for anything else", () => {
    stubUA(UA.linux);
    expect(detectOS()).toBe("linux");
    stubUA("Some/UA NobodyExpects");
    expect(detectOS()).toBe("linux");
  });
});

describe("keyStoreName", () => {
  it("names the platform credential store", () => {
    stubUA(UA.windows);
    expect(keyStoreName()).toBe("Windows Credential Manager");
    stubUA(UA.macos);
    expect(keyStoreName()).toBe("macOS Keychain");
    stubUA(UA.linux);
    expect(keyStoreName()).toBe("system keyring");
  });
});

describe("diskEncryption", () => {
  it("advises BitLocker on Windows and FileVault on macOS", () => {
    stubUA(UA.windows);
    expect(diskEncryption().tool).toContain("BitLocker");
    expect(diskEncryption().os).toBe("Windows");
    stubUA(UA.macos);
    expect(diskEncryption().tool).toBe("FileVault");
    expect(diskEncryption().os).toBe("macOS");
    stubUA(UA.linux);
    expect(diskEncryption().tool).toContain("LUKS");
  });
});

describe("storageLocation", () => {
  it("outside Tauri, reports browser storage (no path maths)", async () => {
    expect(await storageLocation()).toMatch(/browser's local storage/);
  });
});
