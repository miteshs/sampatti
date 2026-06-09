import { describe, expect, it } from "vitest";
import { extractJson, focus, validateDraft, validateDrafts } from "./aiExtract";

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

  it("keeps a USD statement's currency on the account and holdings", () => {
    const raw = {
      name: "Fidelity Brokerage", institution: "Fidelity", account_type: "foreign_broker",
      region: "US", currency: "USD",
      holdings: [{ name: "Apple Inc", asset_class: "us_equity", value: 50000 }],
    };
    const d = validateDraft(raw, "test");
    expect(d.account.currency).toBe("USD");
    expect(d.holdings[0].currency).toBe("USD");
  });

  it("warns when US stocks are mislabeled as INR (the dollar-as-rupee trap)", () => {
    const raw = {
      name: "US Broker", institution: "Schwab", account_type: "foreign_broker",
      region: "US", currency: "INR",
      holdings: [{ name: "Microsoft", asset_class: "us_equity", value: 50000 }],
    };
    const d = validateDraft(raw, "test");
    expect(d.warnings.join(" ")).toMatch(/US stocks.*INR|switch.*USD/i);
  });
});

describe("validateDrafts (multi-account)", () => {
  it("returns one draft per account from the { accounts: [...] } shape", () => {
    const raw = {
      accounts: [
        { name: "Taxable Brokerage", currency: "USD", region: "US", holdings: [{ name: "Apple", asset_class: "us_equity", value: 5000 }] },
        { name: "Retirement IRA", currency: "USD", region: "US", holdings: [{ name: "Treasury Bond", asset_class: "fd_rd", value: 10000 }] },
      ],
    };
    const drafts = validateDrafts(raw, "test");
    expect(drafts.map((d) => d.account.name)).toEqual(["Taxable Brokerage", "Retirement IRA"]);
    expect(drafts[0].holdings[0].name).toBe("Apple");
    expect(drafts[1].holdings[0].name).toBe("Treasury Bond");
  });

  it("falls back to a single account for the bare-object shape", () => {
    const drafts = validateDrafts({ name: "Solo", holdings: [{ name: "X", value: 100 }] }, "test");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].account.name).toBe("Solo");
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
