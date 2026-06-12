// The extraction cost policy as an executable contract: on the Claude path, statements run
// cheapest-first (Haiku) and escalate to Sonnet ONLY when the cheap pass comes back empty or
// unparseable. The static PROMPT is sent as the first (cacheable) argument/block. The local
// engine has one model, so it runs exactly one pass.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTRACT_MODEL_CHEAP, EXTRACT_MODEL_STRONG } from "../claude/transport";

const genMock = vi.fn<(staticPrompt: string, statement: string, model: string) => Promise<string>>();
const callClaudeMock = vi.fn<(req: { model: string; messages: { content: unknown }[] }) => Promise<string>>();
const engineForMock = vi.fn<() => "claude" | "local">(() => "claude");

vi.mock("../ai/engine", () => ({
  generateForExtraction: (...a: [string, string, string]) => genMock(...a),
  engineFor: () => engineForMock(),
}));

vi.mock("../claude/transport", async (orig) => {
  const actual = await orig<typeof import("../claude/transport")>();
  return { ...actual, callClaude: (req: unknown) => callClaudeMock(req as never) };
});

import { extractFromImage, extractFromText } from "./aiExtract";

const ONE = '{"accounts":[{"name":"A","holdings":[{"name":"X","value":100}]}]}';
const EMPTY = '{"accounts":[{"name":"A","holdings":[]}]}';
const GARBAGE = "Sorry, I cannot read this statement.";

beforeEach(() => {
  genMock.mockReset();
  callClaudeMock.mockReset();
  engineForMock.mockReset();
  engineForMock.mockReturnValue("claude");
});
afterEach(() => vi.clearAllMocks());

describe("extractFromText — Haiku→Sonnet escalation (Claude path)", () => {
  it("runs only the cheap model when the first pass finds holdings", async () => {
    genMock.mockResolvedValueOnce(ONE);
    const drafts = await extractFromText("a short statement", "src");
    expect(genMock).toHaveBeenCalledTimes(1);
    expect(genMock.mock.calls[0][2]).toBe(EXTRACT_MODEL_CHEAP);
    expect(drafts[0].holdings).toHaveLength(1);
  });

  it("escalates to Sonnet when the cheap pass comes back empty", async () => {
    genMock.mockResolvedValueOnce(EMPTY).mockResolvedValueOnce(ONE);
    const drafts = await extractFromText("statement", "src");
    expect(genMock.mock.calls.map((c) => c[2])).toEqual([EXTRACT_MODEL_CHEAP, EXTRACT_MODEL_STRONG]);
    expect(drafts[0].holdings).toHaveLength(1);
  });

  it("escalates when the cheap pass returns unparseable output", async () => {
    genMock.mockResolvedValueOnce(GARBAGE).mockResolvedValueOnce(ONE);
    const drafts = await extractFromText("statement", "src");
    expect(genMock).toHaveBeenCalledTimes(2);
    expect(genMock.mock.calls[1][2]).toBe(EXTRACT_MODEL_STRONG);
    expect(drafts[0].holdings).toHaveLength(1);
  });

  it("escalates exactly once, even if the strong pass is also empty (no third call)", async () => {
    genMock.mockResolvedValueOnce(EMPTY).mockResolvedValueOnce(EMPTY);
    await extractFromText("statement", "src");
    expect(genMock).toHaveBeenCalledTimes(2);
  });

  it("sends the static PROMPT as the cacheable first argument", async () => {
    genMock.mockResolvedValueOnce(ONE);
    await extractFromText("stmt", "src");
    expect(genMock.mock.calls[0][0]).toMatch(/extract holdings/i);
    expect(genMock.mock.calls[0][1]).not.toMatch(/extract holdings/i); // statement is separate
  });

  it("local engine runs a single pass — no escalation even on an empty result", async () => {
    engineForMock.mockReturnValue("local");
    genMock.mockResolvedValueOnce(EMPTY);
    await extractFromText("statement", "src");
    expect(genMock).toHaveBeenCalledTimes(1);
  });
});

describe("extractFromImage — cache_control + escalation", () => {
  it("sends PROMPT as a cache_control block and tries the cheap model first", async () => {
    callClaudeMock.mockResolvedValueOnce(ONE);
    await extractFromImage("image/png", "BASE64", "src");
    const req = callClaudeMock.mock.calls[0][0];
    expect(req.model).toBe(EXTRACT_MODEL_CHEAP);
    const firstBlock = (req.messages[0].content as { cache_control?: unknown }[])[0];
    expect(firstBlock.cache_control).toEqual({ type: "ephemeral" });
  });

  it("escalates to Sonnet when the cheap image pass is empty", async () => {
    callClaudeMock.mockResolvedValueOnce(EMPTY).mockResolvedValueOnce(ONE);
    const drafts = await extractFromImage("image/png", "BASE64", "src");
    expect(callClaudeMock.mock.calls.map((c) => c[0].model)).toEqual([EXTRACT_MODEL_CHEAP, EXTRACT_MODEL_STRONG]);
    expect(drafts[0].holdings).toHaveLength(1);
  });
});
