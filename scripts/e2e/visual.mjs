// Visual regression: screenshot every tab (demo loaded, CLOCK FROZEN so dates/axes are
// deterministic) and pixel-compare against committed baselines. A CSS-token slip or layout
// break shows up as a diff long before a user sees it.
//
//   npm run e2e:visual            compare against baselines for this platform
//   npm run e2e:visual -- --update  (re)write baselines after an intentional change
//
// Baselines are per-platform (font antialiasing differs): scripts/e2e/baselines/<platform>/.
// In CI with no baselines for the platform yet, candidates are written to .candidates/ and
// the run passes with a notice — commit them as baselines to arm the gate there.

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4712;
const URL_ = `http://localhost:${PORT}`;
const UPDATE = process.argv.includes("--update");
const PLATFORM = process.platform === "darwin" ? "darwin" : "linux";
const BASE_DIR = join(ROOT, "scripts", "e2e", "baselines", PLATFORM);
const CAND_DIR = join(ROOT, "scripts", "e2e", ".candidates");
const FROZEN_NOW = new Date("2026-06-11T12:00:00+05:30").getTime();
const MAX_DIFF_RATIO = 0.003; // 0.3% of pixels — absorbs antialiasing jitter, not layout

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const c of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser",
  ]) if (existsSync(c)) return c;
  throw new Error("Chrome not found — set CHROME_PATH");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll("button")].find((e) => e.textContent?.includes(t));
    if (el) el.click();
    return !!el;
  }, text);

if (!existsSync(join(ROOT, "dist", "index.html"))) execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
// detached + group-kill: killing only the npx wrapper orphans the vite server on linux,
// whose inherited pipe FDs keep this process alive forever (see smoke.mjs — CI hung there).
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "pipe", detached: true });
const stopServer = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); } };
process.on("exit", stopServer);

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=1"] });
let failures = 0;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(URL_)).ok) break; } catch { /* booting */ }
    await sleep(250);
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 860, deviceScaleFactor: 1 });
  // Freeze the clock BEFORE any app code runs: demo dates, axes, "since" chips, held-for
  // columns all become deterministic.
  await page.evaluateOnNewDocument((now) => {
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) { args.length === 0 ? super(now) : super(...args); }
      static now() { return now; }
    };
    Date.parse = RealDate.parse;
    Date.UTC = RealDate.UTC;
  }, FROZEN_NOW);
  page.on("dialog", (d) => void d.accept());

  await page.goto(URL_, { waitUntil: "networkidle2" });
  await sleep(1200);
  await clickText(page, "Load demo portfolio");
  await sleep(1500);

  const SHOTS = [
    ["overview", "Overview"], ["performance", "Performance"], ["manage", "Manage"],
    ["analysis", "AI Analysis"], ["add-data", "Add data"], ["privacy", "Privacy"],
  ];
  mkdirSync(BASE_DIR, { recursive: true });
  mkdirSync(CAND_DIR, { recursive: true });

  const shoot = async (name) => {
    await sleep(600);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await sleep(150);
    const shot = await page.screenshot({ fullPage: true });
    const basePath = join(BASE_DIR, `${name}.png`);

    if (UPDATE || !existsSync(basePath)) {
      if (UPDATE) {
        writeFileSync(basePath, shot);
        console.log(`  ✎ baseline updated: ${PLATFORM}/${name}.png`);
      } else if (process.env.CI) {
        writeFileSync(join(CAND_DIR, `${name}.png`), shot);
        console.log(`  ⚠ no ${PLATFORM} baseline for ${name} — candidate saved (commit to arm the gate)`);
      } else {
        writeFileSync(basePath, shot);
        console.log(`  ✎ baseline created: ${PLATFORM}/${name}.png`);
      }
      return;
    }

    const a = PNG.sync.read(readFileSync(basePath));
    const b = PNG.sync.read(Buffer.from(shot));
    if (a.width !== b.width || a.height !== b.height) {
      failures++;
      writeFileSync(join(CAND_DIR, `${name}.png`), shot);
      console.error(`  ✗ ${name}: size changed ${a.width}×${a.height} → ${b.width}×${b.height} (candidate saved)`);
      return;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
    const ratio = n / (a.width * a.height);
    if (ratio > MAX_DIFF_RATIO) {
      failures++;
      writeFileSync(join(CAND_DIR, `${name}.png`), shot);
      writeFileSync(join(CAND_DIR, `${name}.diff.png`), PNG.sync.write(diff));
      console.error(`  ✗ ${name}: ${(ratio * 100).toFixed(2)}% pixels differ (candidate + diff saved in .candidates/)`);
    } else {
      console.log(`  ✓ ${name} (${(ratio * 100).toFixed(3)}% diff)`);
    }
  };

  for (const [name, tab] of SHOTS) {
    await clickText(page, tab);
    await shoot(name);
  }

  // US-mode Overview: same frozen clock, fresh store → region chip → US demo. Catches
  // gross $-formatting/unit breakage that India-only baselines can't (the $24K-hero class).
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  await clickText(page, "United States");
  await sleep(400);
  await clickText(page, "Load demo portfolio");
  await sleep(1500);
  await shoot("overview-us");
} finally {
  await browser.close();
  stopServer();
}
if (failures > 0) {
  console.error(`\nVisual: ${failures} screen(s) changed. Intentional? → npm run e2e:visual -- --update`);
  process.exit(1);
}
console.log("\nVisual: all screens match.");
process.exit(0); // stray handles must never outlive the verdict
