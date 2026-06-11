import { describe, expect, it } from "vitest";
import { normTaxTreatment, usTaxFromName } from "./classify";

describe("US tax wrappers — aliases and name inference", () => {
  it("normalizes explicit US wrapper strings", () => {
    expect(normTaxTreatment("401k")[0]).toBe("us_pretax");
    expect(normTaxTreatment("Roth IRA")[0]).toBe("us_roth");
    expect(normTaxTreatment("HSA")[0]).toBe("us_hsa");
    expect(normTaxTreatment("Traditional IRA")[0]).toBe("us_pretax");
  });

  it("usTaxFromName: wrappers announce themselves in account names; Roth beats the 401k match", () => {
    expect(usTaxFromName("Fidelity 401(k)")).toBe("us_pretax");
    expect(usTaxFromName("Vanguard 403(b)")).toBe("us_pretax");
    expect(usTaxFromName("Schwab Roth 401(k)")).toBe("us_roth");
    expect(usTaxFromName("My Roth IRA")).toBe("us_roth");
    expect(usTaxFromName("HSA Bank")).toBe("us_hsa");
    expect(usTaxFromName("Zerodha Demat")).toBeNull();
    expect(usTaxFromName("Kotak Bank FDs")).toBeNull();
  });
});
