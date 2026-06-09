// Platform abstraction: the same React app runs as a Tauri desktop app (real local files,
// OS keychain, native HTTP) and as a plain web page (for development and a future PWA).
// Every module that touches storage, secrets, or the network goes through here so the UI
// never branches on the environment.

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
      const { appDataDir } = await import("@tauri-apps/api/path");
      return `${await appDataDir()}${FILE}`;
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
