// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isImportable, classifyFile, ingestFile, NeedsClaudeError } from "./index";

const f = (name: string) => new File(["x"], name, { type: "" });
const csvFile = (name: string, content: string) => new File([content], name, { type: "text/csv" });

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

describe("ingestFile — local first, Claude as fallback signal", () => {
  it("parses a recognizable CSV entirely locally", async () => {
    const drafts = await ingestFile(csvFile("data.csv", "account,name,market_value\nAcme,Reliance,1000\n"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].holdings).toHaveLength(1);
    expect(drafts[0].holdings[0].marketValue).toBe(1000);
  });

  it("throws NeedsClaudeError (carrying the file) when columns aren't recognized", async () => {
    const file = csvFile("weird.csv", "foo,bar\nhello,world\n");
    await expect(ingestFile(file)).rejects.toBeInstanceOf(NeedsClaudeError);
  });
});
