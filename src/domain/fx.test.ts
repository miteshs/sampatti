import { describe, expect, it } from "vitest";
import { parseUsdInr } from "./fx";

describe("parseUsdInr", () => {
  it("extracts and rounds a valid INR rate to 2 dp", () => {
    expect(parseUsdInr({ rates: { INR: 95.4567 } })).toBe(95.46);
    expect(parseUsdInr({ rates: { INR: 83 } })).toBe(83);
  });

  it("returns null for missing or invalid shapes", () => {
    expect(parseUsdInr(null)).toBeNull();
    expect(parseUsdInr({})).toBeNull();
    expect(parseUsdInr({ rates: {} })).toBeNull();
    expect(parseUsdInr({ rates: { INR: 0 } })).toBeNull();
    expect(parseUsdInr({ rates: { INR: -5 } })).toBeNull();
    expect(parseUsdInr({ rates: { INR: "95" } })).toBeNull();
  });
});
