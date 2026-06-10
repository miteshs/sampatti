// @vitest-environment jsdom
// The Privacy screen is where the app makes its security promises — these tests pin that
// the promises match the OS the build is actually running on (Keychain/FileVault on a Mac,
// Credential Manager/BitLocker on Windows) and that the shown data path is join()ed, not
// string-concatenated.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio } from "../domain/types";

// Privacy (via the platform layer) reaches for the Tauri APIs when it thinks it's on
// desktop — give it inert stand-ins. join("|") makes separator handling observable.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(false) }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("APPDATA"),
  join: vi.fn(async (...parts: string[]) => parts.join("|")),
}));

import { Privacy } from "./Privacy";

const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0",
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
};

function desktopOn(ua: string) {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function renderByoPrivacy() {
  const p = emptyPortfolio();
  p.settings.claudeMode = "byo";
  useStore.setState({ portfolio: p, loaded: true });
  return render(<Privacy />);
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
});

describe("Privacy screen names the right OS facilities", () => {
  it("Windows desktop: Credential Manager + BitLocker, and no Keychain talk", async () => {
    desktopOn(UA.windows);
    renderByoPrivacy();
    expect(await screen.findByText(/Stored in the Windows Credential Manager/)).toBeTruthy();
    expect(screen.getByText(/BitLocker/)).toBeTruthy();
    expect(screen.queryByText(/Keychain/)).toBeNull();
    expect(screen.queryByText(/FileVault/)).toBeNull();
  });

  it("macOS desktop: Keychain + FileVault", async () => {
    desktopOn(UA.macos);
    renderByoPrivacy();
    expect(await screen.findByText(/Stored in the macOS Keychain/)).toBeTruthy();
    expect(screen.getByText(/FileVault/)).toBeTruthy();
    expect(screen.queryByText(/Credential Manager/)).toBeNull();
  });

  it("desktop: shows the data file path assembled with join(), not concatenation", async () => {
    desktopOn(UA.windows);
    renderByoPrivacy();
    // appDataDir + separator + file — our join() stub uses "|" so concat would show "APPDATAportfolio.json".
    expect(await screen.findByText("APPDATA|portfolio.json")).toBeTruthy();
  });

  it("web preview: tab-only key, no OS store named", async () => {
    renderByoPrivacy();
    expect(await screen.findByText(/kept in this tab's memory only/)).toBeTruthy();
    expect(screen.getByText(/file on your computer instead/)).toBeTruthy();
    expect(screen.queryByText(/Stored in the macOS Keychain/)).toBeNull();
  });
});
