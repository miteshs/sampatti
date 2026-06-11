// UI audit: screenshot every tab in both regions from the built app (frozen clock, demo
// portfolio), full-page, into scripts/demo-video/out/audit/. Reuses the recorder's serve+
// drive approach without the video machinery.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "scripts", "demo-video", "out", "audit");
const PORT = 4714;
const URL_ = `http://localhost:${PORT}`;
const FROZEN_NOW = new Date("2026-06-11T12:00:00+05:30").getTime();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const c of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) if (existsSync(c)) return c;
  throw new Error("Chrome not found");
}

mkdirSync(OUT, { recursive: true });
if (!existsSync(join(ROOT, "dist", "index.html"))) execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "pipe", detached: true });
const stopServer = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); } };
process.on("exit", stopServer);

const browser = await puppeteer.launch({
  executablePath: chromePath(), headless: "new",
  args: ["--no-sandbox", "--force-device-scale-factor=2", "--hide-scrollbars"],
});
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(URL_)).ok) break; } catch {} await sleep(250); }
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((now) => {
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { a.length === 0 ? super(now) : super(...a); } static now() { return now; } };
    Date.parse = RealDate.parse; Date.UTC = RealDate.UTC;
  }, FROZEN_NOW);
  page.on("dialog", (d) => void d.accept());
  await page.goto(URL_, { waitUntil: "networkidle2" });

  const click = (text) => page.evaluate((t) => {
    [...document.querySelectorAll("button, a")].find((e) => e.textContent?.includes(t))?.click();
  }, text);

  for (const region of ["India", "United States"]) {
    const tag = region === "India" ? "in" : "us";
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1200);
    await page.screenshot({ path: join(OUT, `${tag}-0-welcome.png`) });
    await click(region); await sleep(700);
    await click("Load demo portfolio"); await sleep(1200);
    const tabs = [["Overview", "1-overview"], ["Performance", "2-performance"], ["Manage", "3-manage"],
      ["AI Analysis", "4-ai"], ["Add data", "5-adddata"], ["Privacy", "6-privacy"], ["Settings", "7-settings"]];
    for (const [label, name] of tabs) {
      await click(label); await sleep(1600);
      await page.screenshot({ path: join(OUT, `${tag}-${name}.png`), fullPage: true });
    }
    console.log(`✓ ${region}`);
  }
} finally {
  await browser.close();
  stopServer();
}
process.exit(0);
