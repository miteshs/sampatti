// One-off GENERATOR (not a gate): writes importable backups of the demo portfolios into
// samples/demo-statements/<region>/. Importing one via Settings → Privacy & data → "Import a
// backup" restores the FULL demo — holdings AND the recorded ~18-month trend — because the
// export JSON carries snapshots/flows. (Plain statements can only carry holdings, not daily
// history, so the .json is the faithful "recreate the demo" path.)
//
// It WRITES files, so it's guarded behind GEN_DEMO and skipped by default (incl. verify:imports).
// Regenerate after the demo changes with:
//   GEN_DEMO=1 npx vitest run --config scripts/vitest.config.ts scripts/gen-demo-statements.test.ts
import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoPortfolio } from "../src/demo";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGIONS = [["India", "india"], ["US", "us"]] as const;

describe("demo backups", () => {
  it.runIf(!!process.env.GEN_DEMO)("writes sampatti-demo-<region>.json for each region", () => {
    for (const [country, dir] of REGIONS) {
      const out = join(ROOT, "samples", "demo-statements", dir);
      mkdirSync(out, { recursive: true });
      const p = demoPortfolio(country);
      writeFileSync(join(out, `sampatti-demo-${dir}.json`), JSON.stringify(p, null, 2) + "\n");
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${dir}: ${p.accounts.length} accounts · ${p.holdings.length} holdings · ${p.snapshots.length} days of history`);
    }
  });
});
