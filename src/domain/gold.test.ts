import { describe, expect, it } from "vitest";
import { goldPerGramInr } from "./gold";

const TROY_OZ_GRAMS = 31.1034768;

describe("goldPerGramInr (USD/troy-oz → ₹/gram)", () => {
  it("converts using the USD→INR rate and troy-ounce weight", () => {
    expect(goldPerGramInr(4344.3, 95)).toBe(Math.round((4344.3 * 95) / TROY_OZ_GRAMS));
    expect(goldPerGramInr(2000, 83)).toBe(Math.round((2000 * 83) / TROY_OZ_GRAMS));
  });

  it("returns null for invalid inputs", () => {
    expect(goldPerGramInr(0, 95)).toBeNull();
    expect(goldPerGramInr(-5, 95)).toBeNull();
    expect(goldPerGramInr("4000", 95)).toBeNull();
    expect(goldPerGramInr(NaN, 95)).toBeNull();
    expect(goldPerGramInr(4000, 0)).toBeNull();
    expect(goldPerGramInr(null, 95)).toBeNull();
  });
});
