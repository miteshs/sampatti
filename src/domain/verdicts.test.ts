import { describe, expect, it } from "vitest";
import { concentrationVerdict, equityVerdict, liquidityVerdict } from "./verdicts";

describe("equityVerdict", () => {
  it("low / balanced / high bands", () => {
    expect(equityVerdict(10).tone).toBe("ok");
    expect(equityVerdict(20).tone).toBe("good");
    expect(equityVerdict(60).tone).toBe("good");
    expect(equityVerdict(61).tone).toBe("watch");
  });
});

describe("concentrationVerdict", () => {
  it("spread / concentrated / very concentrated bands", () => {
    expect(concentrationVerdict(34).tone).toBe("good");
    expect(concentrationVerdict(35).tone).toBe("watch");
    expect(concentrationVerdict(61).text).toMatch(/Very concentrated/);
  });
});

describe("liquidityVerdict", () => {
  it("healthy / some / locked bands", () => {
    expect(liquidityVerdict(25).tone).toBe("good");
    expect(liquidityVerdict(10).tone).toBe("ok");
    expect(liquidityVerdict(9).tone).toBe("watch");
  });
});

it("every verdict stays one short plain sentence (fits a stat card)", () => {
  for (const v of [equityVerdict(50), concentrationVerdict(50), liquidityVerdict(5)]) {
    expect(v.text.length).toBeLessThan(80);
    expect(v.text).not.toMatch(/HHI|P&L|basis|unrealized/i);
  }
});
