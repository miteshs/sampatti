// The consent-gate decision matrix — this is the "no warning when nothing leaves the
// device" promise (and its inverse: anything Claude-bound ALWAYS gates) as unit tests.
import { describe, expect, it } from "vitest";
import { filesForClaude, planBatch } from "./consent";
import type { IngestKind } from "./index";

describe("planBatch — engine-aware consent gate", () => {
  it("deterministic files (CSV/Excel/CAS) parse straight away on any engine", () => {
    expect(planBatch(["local", "local"], "claude", false)).toBe("run");
    expect(planBatch(["local"], "local", false)).toBe("run"); // no AI needed → model state irrelevant
  });

  it("claude engine: anything AI-bound requires the consent card", () => {
    expect(planBatch(["local", "ai-text"], "claude", false)).toBe("confirm");
    expect(planBatch(["ai-image"], "claude", true)).toBe("confirm");
  });

  it("local engine + model ready: text statements run with NO 'sent to Claude' gate", () => {
    expect(planBatch(["ai-text"], "local", true)).toBe("run");
    expect(planBatch(["local", "ai-text", "ai-text"], "local", true)).toBe("run");
  });

  it("local engine + model ready: images still gate — they always use Claude", () => {
    expect(planBatch(["ai-image"], "local", true)).toBe("confirm");
    expect(planBatch(["ai-text", "ai-image"], "local", true)).toBe("confirm");
  });

  it("local engine without the model: text files get download-or-Claude, never a silent failure", () => {
    expect(planBatch(["ai-text"], "local", false)).toBe("model-missing");
    expect(planBatch(["local", "ai-text", "ai-image"], "local", false)).toBe("model-missing");
  });

  it("local engine without the model, images only: plain Claude consent (no model needed)", () => {
    expect(planBatch(["ai-image"], "local", false)).toBe("confirm");
  });
});

describe("filesForClaude — what the consent card lists as leaving the device", () => {
  const classify = (f: string): IngestKind =>
    f.endsWith(".png") ? "ai-image" : f.endsWith(".pdf") ? "ai-text" : "local";
  const batch = ["a.csv", "b.pdf", "c.png"];

  it("claude engine: every AI-bound file", () => {
    expect(filesForClaude(batch, classify, "claude")).toEqual(["b.pdf", "c.png"]);
  });

  it("local engine: only the images — text PDFs stay on-device", () => {
    expect(filesForClaude(batch, classify, "local")).toEqual(["c.png"]);
  });
});
