import { describe, expect, it } from "vitest";
import { extractJson, focus, validateDraft } from "./aiExtract";

describe("extractJson", () => {
  it("pulls a clean JSON object out of fenced/chatty model output", () => {
    const out = '```json\n{"name":"X","holdings":[]}\n```\nHope that helps!';
    expect(extractJson(out)).toEqual({ name: "X", holdings: [] });
  });

  it("repairs a truncated object by closing open containers", () => {
    const out = '{"name":"X","holdings":[{"name":"A","value":100';
    const obj = extractJson(out) as { name: string; holdings: { value: number }[] };
    expect(obj.name).toBe("X");
    expect(obj.holdings[0].value).toBe(100);
  });
});

describe("validateDraft", () => {
  it("coerces a raw Indian PMS statement object into a draft", () => {
    const raw = {
      name: "Marcellus PMS", institution: "Marcellus", account_type: "pms",
      tax_treatment: "taxable", region: "India", currency: "INR", as_of: "2026-03-31",
      holdings: [{ name: "Consistent Compounders", asset_class: "stock", value: "85,00,000" }],
    };
    const d = validateDraft(raw, "test");
    expect(d.account.accountType).toBe("pms_aif");
    expect(d.account.region).toBe("India");
    expect(d.holdings[0].assetClass).toBe("indian_equity");
    expect(d.holdings[0].marketValue).toBe(8_500_000);
  });

  it("drops valueless holdings and warns", () => {
    const d = validateDraft({ name: "A", holdings: [{ name: "ghost" }] }, "test");
    expect(d.holdings.length).toBe(0);
    expect(d.warnings.join(" ")).toMatch(/no holdings|no value/i);
  });
});

describe("focus", () => {
  it("keeps money/header lines and drops boilerplate", () => {
    const text = [
      "PRIVACY NOTICE: we value your privacy and blah blah legal text here",
      "Portfolio Value as on 31-Mar-2026  1,08,31,366.11",
      "Some unrelated marketing sentence with no numbers",
      "RELIANCE INDUSTRIES   1180   35,00,000.00",
    ].join("\n");
    const f = focus(text);
    expect(f).toMatch(/Portfolio Value/);
    expect(f).toMatch(/RELIANCE/);
    expect(f).not.toMatch(/marketing sentence/);
  });
});
