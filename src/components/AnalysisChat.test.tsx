// @vitest-environment jsdom
// The tailoring controls (#1 goals/context, #2 focus chips) as a UI contract: they render on
// the start screen, the goals text persists to settings, the chips toggle, and what the user
// picks actually reaches the analysis request (threaded into the prompt trailer).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio } from "../domain/types";

// Capture the request handed to streamAnalysis without touching the network/transport.
const { streamMock, engineMock } = vi.hoisted(() => ({
  streamMock: vi.fn<(...a: unknown[]) => Promise<string>>(async () => "analysis text"),
  engineMock: { engine: "claude" as "claude" | "local" },
}));
vi.mock("../ai/engine", () => ({
  engineFor: () => engineMock.engine,
  streamAnalysis: (...a: unknown[]) => streamMock(...a),
}));

import { AnalysisChat } from "./AnalysisChat";

// A settings state where analysisReady() is true (relay mode + a real relay URL), so the
// start screen shows the Analyze button and the tailoring controls.
function setReady() {
  const p = emptyPortfolio();
  p.settings.claudeMode = "relay";
  p.settings.relayUrl = "https://relay.test/v1";
  useStore.setState({ portfolio: p, loaded: true });
}

beforeEach(() => { setReady(); streamMock.mockClear(); engineMock.engine = "claude"; });
afterEach(() => { cleanup(); localStorage.clear(); });

describe("AnalysisChat — goals & focus tailoring", () => {
  it("renders the goals box and the focus chips on the start screen", () => {
    render(<AnalysisChat />);
    expect(screen.getByPlaceholderText(/retire/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Concentration/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Liquidity/ })).toBeTruthy();
  });

  it("persists the goals text to settings.analysisContext on blur", () => {
    render(<AnalysisChat />);
    const box = screen.getByPlaceholderText(/retire/i);
    fireEvent.change(box, { target: { value: "retiring in 6 years, want to derisk" } });
    fireEvent.blur(box);
    expect(useStore.getState().portfolio.settings.analysisContext).toBe("retiring in 6 years, want to derisk");
  });

  it("toggles a focus chip on and back off (aria-pressed)", () => {
    render(<AnalysisChat />);
    const tax = () => screen.getByRole("button", { name: /Tax/ });
    expect(tax().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(tax());
    expect(tax().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(tax());
    expect(tax().getAttribute("aria-pressed")).toBe("false");
  });

  it("threads the goals text + selected focus into the analysis request", async () => {
    render(<AnalysisChat />);
    fireEvent.change(screen.getByPlaceholderText(/retire/i), { target: { value: "I retire in 6 years" } });
    fireEvent.click(screen.getByRole("button", { name: /Tax/ }));
    fireEvent.click(screen.getByRole("button", { name: /Liquidity/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze my portfolio/i }));

    await waitFor(() => expect(streamMock).toHaveBeenCalled());
    const req = streamMock.mock.calls[0][0] as { messages: { content: { type: string; text?: string }[] }[] };
    const trailer = req.messages[0].content[1].text ?? ""; // block 0 = cached brief, block 1 = trailer
    expect(trailer).toContain("I retire in 6 years");
    expect(trailer).toMatch(/focus on: Tax, Liquidity/);
  });

  it("sends no tailoring when the user fills nothing in", async () => {
    render(<AnalysisChat />);
    fireEvent.click(screen.getByRole("button", { name: /Analyze my portfolio/i }));
    await waitFor(() => expect(streamMock).toHaveBeenCalled());
    const req = streamMock.mock.calls[0][0] as { messages: { content: { type: string; text?: string }[] }[] };
    const trailer = req.messages[0].content[1].text ?? "";
    expect(trailer).not.toMatch(/CLIENT CONTEXT/);
    expect(trailer).not.toMatch(/focus on/i);
  });
});
