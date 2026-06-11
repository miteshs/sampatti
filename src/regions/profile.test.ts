// The region seam's contract: stored country values (including every pre-region save file)
// resolve to a profile, IN formatting is byte-identical to the existing inr(), and the US
// formatter mirrors its shape in $ K/M/B.
import { describe, expect, it } from "vitest";
import { inr } from "../domain/format";
import { PROFILES, profileFor, regionOf } from "./profile";

describe("regionOf — every save file resolves somewhere safe", () => {
  it("maps the two known values", () => {
    expect(regionOf({ country: "India" })).toBe("IN");
    expect(regionOf({ country: "US" })).toBe("US");
  });

  it("anything unknown (old files, hand-edited exports) falls back to India", () => {
    expect(regionOf({ country: "" })).toBe("IN");
    expect(regionOf({ country: "Bharat" })).toBe("IN");
  });
});

describe("IN profile — delegates to the existing formatter, no drift", () => {
  it("matches inr() exactly across magnitudes", () => {
    for (const v of [0, 950, 84_500, 1_25_000, 1_08_31_366, -2_50_00_000]) {
      expect(PROFILES.IN.formatMoney(v)).toBe(inr(v));
      expect(PROFILES.IN.formatMoney(v, { compact: false })).toBe(inr(v, { compact: false }));
    }
  });
});

describe("US profile — $ with K/M/B compaction", () => {
  it("compacts large figures", () => {
    expect(PROFILES.US.formatMoney(1_250_000)).toBe("$1.25M");
    expect(PROFILES.US.formatMoney(2_400_000_000)).toBe("$2.40B");
    expect(PROFILES.US.formatMoney(84_500)).toBe("$84.5K");
  });

  it("keeps small figures plain and honors compact:false", () => {
    expect(PROFILES.US.formatMoney(950)).toBe("$950");
    expect(PROFILES.US.formatMoney(1_250_000, { compact: false })).toBe("$1,250,000");
  });

  it("signs negatives like inr() does (leading −)", () => {
    expect(PROFILES.US.formatMoney(-1_250_000)).toBe("−$1.25M");
  });
});

describe("profileFor — the one lookup components use", () => {
  it("resolves base currency per market", () => {
    expect(profileFor({ country: "India" }).baseCurrency).toBe("INR");
    expect(profileFor({ country: "US" }).baseCurrency).toBe("USD");
  });
});
