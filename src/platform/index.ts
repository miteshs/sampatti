// Platform abstraction: the same React app runs as a Tauri desktop app (real local files,
// OS keychain, native HTTP) and as a plain web page (for development and a future PWA).
// Every module that touches storage, secrets, or the network goes through here so the UI
// never branches on the environment.

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---- local persistence (the portfolio file) --------------------------------

const WEB_KEY = "sampatti.portfolio";
const FILE = "portfolio.json";

export async function readPortfolioRaw(): Promise<string | null> {
  if (isTauri()) {
    const { exists, readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    if (!(await exists(FILE, { baseDir: BaseDirectory.AppData }))) return null;
    return readTextFile(FILE, { baseDir: BaseDirectory.AppData });
  }
  return localStorage.getItem(WEB_KEY);
}

export async function writePortfolioRaw(json: string): Promise<void> {
  if (isTauri()) {
    const { writeTextFile, mkdir, exists, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
    await writeTextFile(FILE, json, { baseDir: BaseDirectory.AppData });
    return;
  }
  localStorage.setItem(WEB_KEY, json);
}

export async function clearPortfolioRaw(): Promise<void> {
  if (isTauri()) {
    const { remove, exists, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    if (await exists(FILE, { baseDir: BaseDirectory.AppData })) {
      await remove(FILE, { baseDir: BaseDirectory.AppData });
    }
    return;
  }
  localStorage.removeItem(WEB_KEY);
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
