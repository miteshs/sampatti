// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isImportable, classifyFile } from "./index";

const f = (name: string) => new File(["x"], name, { type: "" });

describe("isImportable — multi-file / folder filter", () => {
  it("accepts every supported statement type (case-insensitive)", () => {
    for (const n of ["a.csv", "b.xlsx", "c.xls", "d.pdf", "e.png", "f.JPG", "g.jpeg", "h.webp", "i.gif"]) {
      expect(isImportable(f(n))).toBe(true);
    }
  });

  it("skips hidden and macOS system/resource files", () => {
    expect(isImportable(f(".DS_Store"))).toBe(false);
    expect(isImportable(f("._statement.pdf"))).toBe(false);
  });

  it("skips unsupported file types found in a real folder", () => {
    for (const n of ["notes.txt", "archive.zip", "photo.heic", "deck.pptx", "noextension"]) {
      expect(isImportable(f(n))).toBe(false);
    }
  });

  it("routes supported types to the right ingest path", () => {
    expect(classifyFile(f("x.csv"))).toBe("local");
    expect(classifyFile(f("x.xlsx"))).toBe("local");
    expect(classifyFile(f("x.pdf"))).toBe("ai-text");
    expect(classifyFile(f("x.png"))).toBe("ai-image");
  });
});
