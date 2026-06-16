// Capture fresh, retina (@2x) marketing screenshots for the landing page, straight from the
// CURRENT build — so the site never ships stale screens. Loads the demo portfolio with a
// frozen clock (deterministic dates/axes), walks the tabs in India mode, then US mode.
//
//   node scripts/landing/shots.mjs
//
// Output → site/assets/shots/*.png. Adapted from scripts/e2e/visual.mjs (same boot/freeze
// dance), but @2x and cropped to the viewport (not fullPage) for crisp hero/feature images.

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4713;
const URL_ = `http://localhost:${PORT}`;
const OUT = join(ROOT, "site", "assets", "shots");
const FROZEN_NOW = new Date("2026-06-11T12:00:00+05:30").getTime();

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

execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "pipe", detached: true });
const stopServer = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); } };
process.on("exit", stopServer);

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=2"] });
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(URL_)).ok) break; } catch { /* booting */ }
    await sleep(250);
  }
  const page = await browser.newPage();
  // @2x for retina; 1280-wide window gives the desktop layout the screenshots want.
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
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

  mkdirSync(OUT, { recursive: true });
  const shoot = async (name, { full = false } = {}) => {
    await sleep(700);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await sleep(150);
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
    console.log(`  ✎ ${name}.png`);
  };

  await page.goto(URL_, { waitUntil: "networkidle2" });
  await sleep(1200);
  await clickText(page, "Load demo portfolio");
  await sleep(1500);

  // Enable Insights (Health Score + Goals) in Settings so the overviews are feature-rich.
  await clickText(page, "Settings"); await sleep(500);
  await clickText(page, "Portfolio health score"); await sleep(200);
  await clickText(page, "Goals & retirement"); await sleep(400);

  // India mode — the hero (Overview) full-page so the whole dashboard is capturable, plus the
  // feature screens cropped to the fold.
  await clickText(page, "Overview");    await shoot("overview", { full: true });
  await clickText(page, "Performance"); await shoot("performance");
  await clickText(page, "Holdings");    await shoot("holdings");
  await clickText(page, "AI Analysis"); await shoot("analysis", { full: true });

  // Dark-mode overview (Settings → Dark) — for the "your machine, your look" beat.
  await clickText(page, "Settings"); await sleep(300);
  await clickText(page, "Dark");     await sleep(300);
  await clickText(page, "Overview"); await shoot("overview-dark", { full: true });

  // US mode — fresh store → region picker → US demo. Proves the dual-market story with $.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  await clickText(page, "United States"); await sleep(400);
  await clickText(page, "Load demo portfolio"); await sleep(1200);

  // Enable Insights again for the US demo.
  await clickText(page, "Settings"); await sleep(500);
  await clickText(page, "Portfolio health score"); await sleep(200);
  await clickText(page, "Goals & retirement"); await sleep(400);

  await clickText(page, "Overview"); await sleep(1500);
  await shoot("overview-us", { full: true });
} finally {
  await browser.close();
  stopServer();
}
console.log("\nLanding shots written to site/assets/shots/");
process.exit(0);
