// The unit rule as a LAW, learned from the $24K-hero bug (2026-06-11): one quantity,
// rendered from every surface's source, must produce the same string. The hero reads the
// brief, the trend chart reads snapshots, the model reads briefForModel — each path was
// individually plausible while disagreeing by a factor of 95. Cross-surface consistency
// is the only test shape that catches unit bugs: per-component tests validate a component
// against its own (possibly wrong) assumption about which unit it is holding.
import { describe, expect, it } from "vitest";
import { demoPortfolio } from "../demo";
import { buildBrief, briefForModel } from "../domain/brief";
import { bucketSegments } from "../domain/buckets";
import { buildSegments } from "../domain/group";
import { snapshotSeries } from "../domain/snapshots";
import { visiblePortfolio } from "../domain/types";
import { useStore } from "../storage/store";
import { fmtMoney, PROFILES, regionOf } from "./profile";

describe("unit-rule triangle — hero, chart and outbound brief agree", () => {
  for (const country of ["India", "US"] as const) {
    it(`${country} demo: brief, snapshots and the model-edge brief render one net worth`, () => {
      const p = demoPortfolio(country);
      useStore.setState({ portfolio: p, loaded: true });
      const visP = visiblePortfolio(p);
      const visible = new Set(visP.accounts.map((a) => a.id));

      // Hero: internal-INR brief through the display edge.
      const hero = fmtMoney(buildBrief(visP).netWorth);
      // Chart: internal-INR snapshots through the same display edge.
      const pts = snapshotSeries(p.snapshots, visible);
      const chart = fmtMoney(pts[pts.length - 1].netWorth);
      // Outbound: the model-edge brief is ALREADY converted — raw region formatting.
      const outbound = PROFILES[regionOf(p.settings)].formatMoney(briefForModel(visP).netWorth);

      expect(chart).toBe(hero);
      expect(outbound).toBe(hero);
      // Fourth + fifth legs: BOTH allocation sources (the detail table's buildSegments
      // AND the donut's bucketSegments) total to the same "what you own" quantity —
      // the donut had its own aggregation path and kept the mortgage after the first fix.
      const table = buildSegments(visP.holdings, visP.accounts, "asset_class", p.settings.usdInr).total;
      const donut = bucketSegments(visP.holdings, visP.accounts, p.settings.usdInr).total;
      expect(fmtMoney(table)).toBe(fmtMoney(buildBrief(visP).totalAssets));
      expect(fmtMoney(donut)).toBe(fmtMoney(buildBrief(visP).totalAssets));
      // And the factor-of-rate failure modes by name, so a regression reads clearly:
      // double conversion shrinks by ~95×, missing conversion inflates by ~95×.
      expect(hero).not.toBe(fmtMoney(buildBrief(visP).netWorth / p.settings.usdInr));
      expect(hero).not.toBe(fmtMoney(buildBrief(visP).netWorth * p.settings.usdInr));
    });
  }

  it("US demo renders the authored figures the e2e leg also pins in real Chrome", () => {
    const p = demoPortfolio("US");
    useStore.setState({ portfolio: p, loaded: true });
    const visP = visiblePortfolio(p);
    const brief = buildBrief(visP);
    expect(fmtMoney(brief.netWorth)).toBe("$2.35M");
    expect(fmtMoney(brief.totalAssets)).toBe("$2.84M");
    expect(fmtMoney(brief.totalLiabilities)).toBe("$485.0K");
  });
});
