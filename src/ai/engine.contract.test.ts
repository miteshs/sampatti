// @vitest-environment jsdom
// THE local-AI promise as an executable contract: when a task is routed to the on-device
// engine, the ONLY thing it may touch is the `local_generate` Tauri command — never fetch,
// never the relay, never claude_stream. And the Claude route must keep working untouched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeLog, invokeMock } = vi.hoisted(() => {
  const invokeLog: { cmd: string; args: Record<string, unknown> }[] = [];
  const invokeMock = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    invokeLog.push({ cmd, args });
    if (cmd === "local_generate") {
      // Stream a grammar-valid JSON body back, like the real engine would.
      (args.onToken as { onmessage?: (s: string) => void })?.onmessage?.('{"accounts": []}');
      return undefined;
    }
    if (cmd === "claude_stream") {
      (args.onEvent as { onmessage?: (s: string) => void })?.onmessage?.("claude says hi");
      return undefined;
    }
    return undefined;
  });
  return { invokeLog, invokeMock };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage: ((m: unknown) => void) | undefined;
  },
}));

import { useStore } from "../storage/store";
import { emptyPortfolio } from "../domain/types";
import { engineFor, generateForExtraction, streamAnalysis, withExtractionEngine } from "./engine";

const fetchSpy = vi.fn(async () => { throw new Error("network touched"); });

function setEngines(extraction: "claude" | "local", analysis: "claude" | "local") {
  const p = emptyPortfolio();
  p.settings.ai = { extraction, analysis };
  useStore.setState({ portfolio: p, loaded: true });
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.stubGlobal("fetch", fetchSpy);
  invokeLog.length = 0;
  fetchSpy.mockClear();
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe("local engine = zero network (the promise)", () => {
  it("extraction on local touches only local_generate — no fetch, no claude", async () => {
    setEngines("local", "local");
    const out = await generateForExtraction("PROMPT + statement text");
    expect(out).toBe('{"accounts": []}');
    expect(invokeLog.map((c) => c.cmd)).toEqual(["local_generate"]);
    expect(invokeLog[0].args.jsonMode).toBe(true); // grammar-constrained
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("analysis on local streams from local_generate only, with the no-invention guard", async () => {
    setEngines("local", "local");
    const chunks: string[] = [];
    await streamAnalysis(
      { model: "claude-sonnet-4-6", system: "persona", max_tokens: 1000, messages: [{ role: "user", content: "brief here" }] },
      (d) => chunks.push(d),
    );
    expect(invokeLog.map((c) => c.cmd)).toEqual(["local_generate"]);
    expect(String(invokeLog[0].args.prompt)).toContain("never invent figures or tax rules");
    expect(chunks.join("")).toContain("accounts"); // streamed through
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("claude routing is untouched: analysis goes through claude_stream, not the local engine", async () => {
    setEngines("claude", "claude");
    await streamAnalysis(
      { model: "claude-sonnet-4-6", max_tokens: 100, messages: [{ role: "user", content: "hi" }] },
    );
    expect(invokeLog.map((c) => c.cmd)).toEqual(["claude_stream"]);
    expect(invokeLog.some((c) => c.cmd === "local_generate")).toBe(false);
  });
});

describe("withExtractionEngine — the 'use Claude this time' batch override", () => {
  it("forces extraction (only) for the scope of the batch, restores after — even on throw", async () => {
    setEngines("local", "local");
    expect(engineFor("extraction")).toBe("local");
    await withExtractionEngine("claude", async () => {
      expect(engineFor("extraction")).toBe("claude");
      expect(engineFor("analysis")).toBe("local"); // analysis routing untouched
    });
    expect(engineFor("extraction")).toBe("local");
    await expect(withExtractionEngine("claude", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(engineFor("extraction")).toBe("local"); // restored on failure too
  });

  it("a forced-claude batch never touches the local engine", async () => {
    setEngines("local", "local");
    // The claude transport may fail in this mocked env — irrelevant; the assertion is the
    // negative: with the override active, extraction must not invoke local_generate.
    await withExtractionEngine("claude", () => generateForExtraction("text")).catch(() => {});
    expect(invokeLog.some((c) => c.cmd === "local_generate")).toBe(false);
  });
});
