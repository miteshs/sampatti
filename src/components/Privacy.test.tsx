// @vitest-environment jsdom
// The Privacy screen is where the app makes its security promises — these tests pin that
// the promises match the OS the build is actually running on (Keychain/FileVault on a Mac,
// Credential Manager/BitLocker on Windows) and that the shown data path is join()ed, not
// string-concatenated.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("custom-relay warning (the brief goes wherever relayUrl points)", () => {
  function renderRelayPrivacy(relayUrl: string) {
    const p = emptyPortfolio();
    p.settings.claudeMode = "relay";
    p.settings.relayUrl = relayUrl;
    useStore.setState({ portfolio: p, loaded: true });
    return render(<Privacy />);
  }

  it("no warning on the official default relay", () => {
    renderRelayPrivacy(emptyPortfolio().settings.relayUrl);
    expect(screen.queryByText(/Custom relay/)).toBeNull();
  });

  it("warns when the relay URL is changed to anything else", () => {
    renderRelayPrivacy("https://totally-legit-relay.example.workers.dev");
    expect(screen.getByText(/Custom relay/)).toBeTruthy();
    expect(screen.getByText(/Only use a relay you run or fully trust/)).toBeTruthy();
  });

  it("no warning when the URL is empty (the not-configured note shows instead)", () => {
    renderRelayPrivacy("");
    expect(screen.queryByText(/Custom relay/)).toBeNull();
    expect(screen.getByText(/No relay is set yet/)).toBeTruthy();
  });
});

describe("developer mode gates the experimental AI-engines card", () => {
  it("hidden by default: no AI engines card, only the developer-mode switch", () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Privacy />);
    expect(screen.queryByText(/AI engines/)).toBeNull();
    expect(screen.getByText(/Turn on developer mode/)).toBeTruthy();
  });

  it("enabling takes two steps — the risk notice, then the card appears", () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Privacy />);
    fireEvent.click(screen.getByText(/Turn on developer mode/));
    // Risk notice shown; nothing unlocked yet.
    expect(screen.getByText(/heads-up before you switch this on/)).toBeTruthy();
    expect(screen.queryByText(/AI engines/)).toBeNull();
    fireEvent.click(screen.getByText(/I understand — turn it on/));
    expect(useStore.getState().portfolio.settings.developerMode).toBe(true);
    expect(screen.getByText(/AI engines/)).toBeTruthy();
  });

  it("cancel on the notice leaves everything off", () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Privacy />);
    fireEvent.click(screen.getByText(/Turn on developer mode/));
    fireEvent.click(screen.getByText(/Cancel/));
    expect(useStore.getState().portfolio.settings.developerMode).toBe(false);
    expect(screen.queryByText(/AI engines/)).toBeNull();
  });

  it("turning it off also resets engine routing to Claude (visible state == behavior)", () => {
    const p = emptyPortfolio();
    p.settings.developerMode = true;
    p.settings.ai = { extraction: "local", analysis: "local" };
    useStore.setState({ portfolio: p, loaded: true });
    render(<Privacy />);
    fireEvent.click(screen.getByText(/Turn off developer mode/));
    const s = useStore.getState().portfolio.settings;
    expect(s.developerMode).toBe(false);
    expect(s.ai).toEqual({ extraction: "claude", analysis: "claude" });
    expect(screen.queryByText(/AI engines/)).toBeNull();
  });
});
