import { describe, expect, it } from "vitest";
import { BUCKET_META, CLASS_BUCKET, bucketSegments } from "./buckets";
import { ASSET_CLASS_LABEL } from "./classify";
import type { AssetClass, Holding } from "./types";

const h = (assetClass: AssetClass, marketValue: number, currency = "INR"): Holding =>
  ({ id: assetClass + marketValue, accountId: "a", name: assetClass, assetClass, marketValue, currency } as Holding);

describe("CLASS_BUCKET", () => {
  it("maps every asset class the app knows about (nothing falls out of the donut)", () => {
    for (const cls of Object.keys(ASSET_CLASS_LABEL) as AssetClass[]) {
      expect(CLASS_BUCKET[cls], `bucket for ${cls}`).toBeDefined();
      expect(BUCKET_META[CLASS_BUCKET[cls]]).toBeDefined();
    }
  });

  it("bucket colors are distinct (the legend depends on it)", () => {
    const colors = Object.values(BUCKET_META).map((b) => b.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("bucketSegments", () => {
  it("groups, sums and preserves the grand total", () => {
    const holdings = [
      h("indian_equity", 100), h("equity_mf", 50), // equity 150
      h("fd_rd", 80), h("epf_ppf", 20), // fixed 100
      h("gold_sgb", 30), // gold 30
      h("cash", 20), // cash_other 20
    ];
    const { total, segments } = bucketSegments(holdings, [], 88);
    expect(total).toBe(300);
    expect(segments.map((s) => [s.key, s.value])).toEqual([
      ["equity", 150], ["fixed", 100], ["gold", 30], ["cash_other", 20],
    ]);
    expect(segments.reduce((s, x) => s + x.value, 0)).toBe(total);
  });

  it("keeps the detail keys of each bucket for click-to-expand", () => {
    const { segments } = bucketSegments([h("indian_equity", 10), h("us_equity", 5)], [], 88);
    expect(segments).toHaveLength(1);
    expect(segments[0].classes.sort()).toEqual(["indian_equity", "us_equity"]);
  });

  it("USD holdings convert at the given rate before bucketing", () => {
    const { total } = bucketSegments([h("us_equity", 1, "USD")], [], 90);
    expect(total).toBe(90);
  });

  it("empty buckets are dropped, order is stable", () => {
    const { segments } = bucketSegments([h("real_estate", 1), h("indian_equity", 1)], [], 88);
    expect(segments.map((s) => s.key)).toEqual(["equity", "property"]);
  });
});
