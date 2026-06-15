// Auto-update for the Developer-ID direct downloads. The app checks a static manifest on the
// public releases repo (…/releases/latest/download/latest.json), and — if a newer signed build
// exists — downloads it, verifies the minisign signature against the pubkey baked into
// tauri.conf.json, swaps the app, and relaunches. Desktop (Tauri) only; on the web preview the
// whole thing no-ops. Network + install happen in Rust (the plugin), not the webview.
import { isTauri } from "./platform";

export type UpdateProgress = (pct: number, phase: "downloading" | "installing") => void;

export interface PendingUpdate {
  version: string;
  notes?: string;
  // Download + verify + install the update, reporting progress, then relaunch the app.
  install(onProgress?: UpdateProgress): Promise<void>;
}

// Look for a newer release. Returns the pending update, or null when none is available (also
// null on the web preview). Throws on a real failure (offline, bad manifest) — callers catch.
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;

  return {
    version: update.version,
    notes: update.body,
    async install(onProgress) {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          onProgress?.(total ? Math.round((got / total) * 100) : 0, "downloading");
        } else if (ev.event === "Finished") {
          onProgress?.(100, "installing");
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
