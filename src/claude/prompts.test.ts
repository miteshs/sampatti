// Analysis tailoring as a contract: the client's goals/context (#1) and focus areas (#2)
// shape the per-call instruction, but they ride in the TRAILER block — the cached brief block
// stays byte-identical, so tailoring never breaks the prompt cache or touches the guardrails.
import { describe, expect, it } from "vitest";
import { chatMessages, initialMessages } from "./prompts";
import type { Block } from "./transport";
import type { Brief } from "../domain/brief";

// briefText only JSON.stringifies the brief, so a minimal stand-in is enough here.
const brief = { netWorth: 12_500_000 } as unknown as Brief;

const blocks = (content: Block[] | string): Block[] => (Array.isArray(content) ? content : []);
const textOf = (b: Block): string => (b.type === "text" ? b.text : "");
const cacheOf = (b: Block) => (b.type === "text" ? b.cache_control : undefined);

describe("initialMessages — tailoring", () => {
  it("appends client context and focus to the trailer, keeping the brief block cacheable", () => {
    const content = blocks(initialMessages(brief, { context: "I retire in 5 years", focus: ["Tax", "Liquidity"] })[0].content);
    expect(cacheOf(content[0])).toEqual({ type: "ephemeral" }); // brief stays the cached prefix
    const trailer = textOf(content[1]);
    expect(trailer).toContain("I retire in 5 years");
    expect(trailer).toMatch(/focus on: Tax, Liquidity/);
  });

  it("keeps the cached brief block byte-identical with or without tailoring (cache preserved)", () => {
    const plain = blocks(initialMessages(brief)[0].content)[0];
    const tailored = blocks(initialMessages(brief, { context: "x", focus: ["Tax"] })[0].content)[0];
    expect(tailored).toEqual(plain);
  });

  it("omits the context section when the context is blank or whitespace", () => {
    const trailer = textOf(blocks(initialMessages(brief, { context: "   ", focus: [] })[0].content)[1]);
    expect(trailer).not.toMatch(/CLIENT CONTEXT/);
    expect(trailer).not.toMatch(/focus on/i);
  });

  it("is unchanged from the untailored prompt when no tailoring is passed", () => {
    expect(initialMessages(brief)).toEqual(initialMessages(brief, {}));
  });
});

describe("chatMessages — tailoring", () => {
  it("threads client context into the follow-up intro but not the focus list", () => {
    const intro = textOf(blocks(chatMessages(brief, [], "what now?", { context: "goal: kids' college", focus: ["Tax"] })[0].content)[1]);
    expect(intro).toContain("kids' college");
    expect(intro).not.toMatch(/focus on/i);
  });

  it("keeps the cached brief block byte-identical with or without context", () => {
    const plain = blocks(chatMessages(brief, [], "q")[0].content)[0];
    const tailored = blocks(chatMessages(brief, [], "q", { context: "I'm 60" })[0].content)[0];
    expect(tailored).toEqual(plain);
  });
});
