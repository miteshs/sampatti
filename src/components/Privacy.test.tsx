// @vitest-environment jsdom
// The privacy promises are split now: the at-rest / what-leaves EXPLAINER lives in
// <PrivacyExplainer/> (shown in the Settings "How Sampatti handles your data" modal); the
// key/relay copy lives in <Settings/> under developer mode; and the data controls (export /
// erase) live in the Settings "Privacy & data" section. These tests pin each promise to the
// OS the build runs on and that the controls are where they should be.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio } from "../domain/types";

// The privacy/settings copy reaches for Tauri APIs when it thinks it's on desktop — give it
// inert stand-ins. join("|") makes separator handling observable.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(false) }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("APPDATA"),
  join: vi.fn(async (...parts: string[]) => parts.join("|")),
}));

import { PrivacyExplainer } from "./Privacy";
import { Settings } from "./Settings";

const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0",
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
};
function desktopOn(ua: string) {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
});

describe("the privacy explainer names the right at-rest facility for the OS", () => {
  it("Windows: BitLocker, not FileVault", async () => {
    desktopOn(UA.windows);
    render(<PrivacyExplainer />);
    expect(await screen.findByText(/BitLocker/)).toBeTruthy();
    expect(screen.queryByText(/FileVault/)).toBeNull();
  });

  it("macOS: FileVault, not BitLocker", async () => {
    desktopOn(UA.macos);
    render(<PrivacyExplainer />);
    expect(await screen.findByText(/FileVault/)).toBeTruthy();
    expect(screen.queryByText(/BitLocker/)).toBeNull();
  });

  it("desktop: shows the data file path assembled with join(), not concatenation", async () => {
    desktopOn(UA.windows);
    render(<PrivacyExplainer />);
    // appDataDir + separator + file — our join() stub uses "|" so concat would show "APPDATAportfolio.json".
    expect(await screen.findByText("APPDATA|portfolio.json")).toBeTruthy();
  });

  it("web preview: the file-on-your-computer note (no OS encryption to enable)", async () => {
    render(<PrivacyExplainer />);
    expect(await screen.findByText(/file on your computer instead/)).toBeTruthy();
  });
});

// The relay/own-key controls live under developer mode now — render Settings with it on.
function renderByoSettings() {
  const p = emptyPortfolio();
  p.settings.claudeMode = "byo";
  p.settings.developerMode = true;
  useStore.setState({ portfolio: p, loaded: true });
  return render(<Settings />);
}

function renderRelaySettings(relayUrl: string) {
  const p = emptyPortfolio();
  p.settings.claudeMode = "relay";
  p.settings.developerMode = true;
  p.settings.relayUrl = relayUrl;
  useStore.setState({ portfolio: p, loaded: true });
  return render(<Settings />);
}

describe("AI connection controls (relay / own-key under developer mode)", () => {
  it("own-key mode exposes the API key field", async () => {
    renderByoSettings();
    expect(await screen.findByText("API Key")).toBeTruthy();
  });

  it("relay mode exposes the relay URL and access-code fields", async () => {
    renderRelaySettings(emptyPortfolio().settings.relayUrl);
    expect(await screen.findByText("Relay URL")).toBeTruthy();
    expect(screen.getByText("Relay access code")).toBeTruthy();
  });

  it("without developer mode, only the simple access-code field shows", () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Settings />);
    expect(screen.getByText("Access code")).toBeTruthy();
    expect(screen.queryByText("Relay URL")).toBeNull();
    expect(screen.queryByText("API Key")).toBeNull();
  });
});

describe("developer mode gates the experimental AI-engines card", () => {
  it("hidden by default: no AI engines card, only the developer-mode switch", () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Settings />);
    expect(screen.queryByText(/AI engines/)).toBeNull();
    expect(screen.getByText(/Turn on developer mode/)).toBeTruthy();
  });

  it("enabling takes two steps — the risk notice, then the card appears", () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Settings />);
    fireEvent.click(screen.getByText(/Turn on developer mode/));
    expect(screen.getByText(/heads-up before you switch this on/)).toBeTruthy();
    expect(screen.queryByText(/AI engines/)).toBeNull();
    fireEvent.click(screen.getByText(/I understand — turn it on/));
    expect(useStore.getState().portfolio.settings.developerMode).toBe(true);
    expect(screen.getByText(/AI engines/)).toBeTruthy();
  });

  it("cancel on the notice leaves everything off", () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Settings />);
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
    render(<Settings />);
    fireEvent.click(screen.getByText(/Turn off developer mode/));
    const s = useStore.getState().portfolio.settings;
    expect(s.developerMode).toBe(false);
    expect(s.ai).toEqual({ extraction: "claude", analysis: "claude" });
    expect(screen.queryByText(/AI engines/)).toBeNull();
  });
});

describe("Privacy & data lives in Settings", () => {
  it("export + erase controls are present, and the explainer opens in a modal", async () => {
    useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
    render(<Settings />);
    expect(screen.getByText(/Export everything/)).toBeTruthy();
    expect(screen.getByText(/Erase all data/)).toBeTruthy();
    // The transparency explainer is one click away, in a modal.
    fireEvent.click(screen.getByText(/How Sampatti handles your data/));
    expect(await screen.findByText(/Where your data lives, and what leaves/)).toBeTruthy();
  });
});
