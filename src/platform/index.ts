// Platform abstraction: the same React app runs as a Tauri desktop app (real local files,
// OS keychain, native HTTP) and as a plain web page (for development and a future PWA).
// Every module that touches storage, secrets, or the network goes through here so the UI
// never branches on the environment.

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---- which OS the desktop app is on (drives copy, never behavior) -----------
// The webview's UA is reliable for the big two: WebView2 says "Windows NT",
// WKWebView says "Macintosh". Everything else is treated as Linux.

export type DesktopOS = "macos" | "windows" | "linux";

export function detectOS(): DesktopOS {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  return "linux";
}

// Where the BYO Anthropic key lives on this platform — shown wherever the UI
// promises the key never leaves the machine.
export function keyStoreName(): string {
  switch (detectOS()) {
    case "windows": return "Windows Credential Manager";
    case "macos": return "macOS Keychain";
    default: return "system keyring";
  }
}

// The platform's full-disk encryption, for the Privacy screen's "at rest" advice.
export function diskEncryption(): { os: string; tool: string; where: string } {
  switch (detectOS()) {
    case "windows":
      return { os: "Windows", tool: "Device encryption (BitLocker)", where: "Settings → Privacy & security" };
    case "macos":
      return { os: "macOS", tool: "FileVault", where: "System Settings → Privacy & Security" };
    default:
      return { os: "Linux", tool: "full-disk encryption (LUKS)", where: "usually chosen at install time" };
  }
}

// ---- local persistence (the portfolio file) --------------------------------

const WEB_KEY = "sampatti.portfolio";
const FILE = "portfolio.json";

// On desktop we prefer a real file in the app-data dir, but if the Tauri fs plugin
// errors for any reason (scope/permissions/missing dir), we fall back to the webview's
// localStorage so the app still loads and persists rather than hanging on boot.
export async function readPortfolioRaw(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { exists, readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      if (await exists(FILE, { baseDir: BaseDirectory.AppData })) {
        return await readTextFile(FILE, { baseDir: BaseDirectory.AppData });
      }
    } catch (e) {
      console.error("Tauri fs read failed; using local storage fallback:", e);
      return localStorage.getItem(WEB_KEY);
    }
    return localStorage.getItem(WEB_KEY); // not yet written to the file; check fallback
  }
  return localStorage.getItem(WEB_KEY);
}

export async function writePortfolioRaw(json: string): Promise<void> {
  if (isTauri()) {
    try {
      const { writeTextFile, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      try {
        await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
      } catch { /* dir already exists, or creation not permitted — try the write anyway */ }
      await writeTextFile(FILE, json, { baseDir: BaseDirectory.AppData });
      return;
    } catch (e) {
      console.error("Tauri fs write failed; using local storage fallback:", e);
    }
  }
  localStorage.setItem(WEB_KEY, json);
}

export async function clearPortfolioRaw(): Promise<void> {
  if (isTauri()) {
    try {
      const { remove, exists, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      if (await exists(FILE, { baseDir: BaseDirectory.AppData })) {
        await remove(FILE, { baseDir: BaseDirectory.AppData });
      }
    } catch (e) {
      console.error("Tauri fs remove failed:", e);
    }
  }
  localStorage.removeItem(WEB_KEY);
}

// Remove EVERY on-device cache/derived store keyed under "sampatti." — the portfolio mirror,
// the net-worth price-history cache, and anything added later. Used by "Erase all data" so a
// wipe leaves nothing behind. Does NOT touch the BYO API key (a credential with its own
// "Remove key" control; on desktop it lives in the OS keychain, never in web storage).
export function clearLocalCaches(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sampatti.")) localStorage.removeItem(k);
  } catch { /* storage unavailable — nothing to clear */ }
}

// The human-readable location of the data file, shown on the Privacy screen.
export async function storageLocation(): Promise<string> {
  if (isTauri()) {
    try {
      // join(), not string concat: appDataDir() has no trailing separator, and the
      // separator itself differs on Windows.
      const { appDataDir, join } = await import("@tauri-apps/api/path");
      return await join(await appDataDir(), FILE);
    } catch {
      return "your app-data folder";
    }
  }
  return "this browser's local storage (on this device)";
}

// ---- the bring-your-own Anthropic key --------------------------------------
// Desktop: stored in the OS keychain via a Rust command (never in the webview).
// Web fallback: sessionStorage only (cleared when the tab closes) — never persisted.

const WEB_KEY_STORE = "sampatti.byokey";

export async function setByoKey(key: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_api_key", { key });
    return;
  }
  sessionStorage.setItem(WEB_KEY_STORE, key);
}

export async function hasByoKey(): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("has_api_key");
  }
  return sessionStorage.getItem(WEB_KEY_STORE) != null;
}

export async function clearByoKey(): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_api_key");
    return;
  }
  sessionStorage.removeItem(WEB_KEY_STORE);
}

// Web-only: read the key back to call Anthropic directly from the browser. On desktop
// the key stays in Rust and is used there, so this returns null.
export function webByoKey(): string | null {
  if (isTauri()) return null;
  return sessionStorage.getItem(WEB_KEY_STORE);
}
