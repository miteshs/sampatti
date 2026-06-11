// End-to-end smoke: boots the BUILT web app in real Chrome and walks the whole user
// journey — first-run welcome → CSV import → draft review → commit → demo load → every
// tab → export → erase — asserting store state along the way. This is the test class that
// catches what unit tests can't: silently-broken buttons, wiring regressions, view crashes.
//
//   npm run e2e            (needs Chrome; set CHROME_PATH to override discovery)
//
// Exits non-zero on the first failed step or any uncaught page exception.

import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4711;
const URL_ = `http://localhost:${PORT}`;

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("Chrome not found — set CHROME_PATH");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, what, timeout = 10_000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${what}`);
    await sleep(150);
  }
}

const bodyHas = (page, text) =>
  page.evaluate((t) => {
    if (document.body.innerText.includes(t)) return true;
    // Editable fields (draft review rows) render text as input VALUES, not innerText.
    return [...document.querySelectorAll("input")].some((i) => i.value.includes(t));
  }, text);
const clickText = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll("button, summary")].find((e) => e.textContent?.includes(t));
    if (!el) return false;
    el.click();
    return true;
  }, text);
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sampatti.portfolio") ?? "null"));

let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    throw e;
  }
}

// ---- serve the built app -----------------------------------------------------
if (!existsSync(join(ROOT, "dist", "index.html"))) {
  console.log("dist/ missing — building…");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
}
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "pipe" });
process.on("exit", () => server.kill());

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: "new", args: ["--no-sandbox"] });
try {
  // wait for the server
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(URL_); if (r.ok) break; } catch { /* not up yet */ }
    await sleep(250);
    if (i === 59) throw new Error("vite preview never came up");
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 860 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("dialog", (d) => void d.accept()); // demo-replace confirm

  await page.goto(URL_, { waitUntil: "networkidle2" });

  await step("first run shows the welcome with one clear choice", async () => {
    await waitFor(page, () => bodyHas(page, "All your money, in one private picture"), "welcome headline");
    if (!(await bodyHas(page, "Load demo portfolio"))) throw new Error("demo CTA missing");
  });

  await step("CSV import → review card → commit lands in the store", async () => {
    const input = await page.$('input[type="file"][accept]');
    await input.uploadFile(join(ROOT, "scripts", "e2e", "fixtures", "smoke.csv"));
    await waitFor(page, () => bodyHas(page, "Review draft"), "review card");
    if (!(await bodyHas(page, "Alpha Industries"))) throw new Error("parsed holding missing from card");
    if (!(await clickText(page, "Add 2 holdings"))) throw new Error("commit button not found");
    await sleep(500); // persist debounce
    const p = await store(page);
    if (p.accounts.length !== 1 || p.holdings.length !== 2) throw new Error(`store has ${p.accounts.length} accounts / ${p.holdings.length} holdings`);
    if (p.holdings[0].costBasis == null) throw new Error("cost basis lost on commit");
  });

  await step("demo loads over data (confirm accepted) and Overview renders the hero", async () => {
    await clickText(page, "Load demo portfolio");
    await sleep(700);
    await clickText(page, "Overview");
    await waitFor(page, () => bodyHas(page, "Net worth"), "hero");
    if (!(await bodyHas(page, "Cr"))) throw new Error("crore-scale figure missing");
    if (!(await bodyHas(page, "you own"))) throw new Error("assets/loans line missing");
  });

  await step("Performance: stack, Measured card, By-account grouping", async () => {
    await clickText(page, "Performance");
    await waitFor(page, () => bodyHas(page, "Your portfolio, account by account"), "stack card");
    if (!(await bodyHas(page, "Measured"))) throw new Error("coverage card missing");
    await clickText(page, "By account");
    await waitFor(page, () => page.evaluate(() => /·\s*\d+ holdings?/.test(document.body.innerText)), "account subtotal header");
  });

  await step("Manage and AI Analysis render their key affordances", async () => {
    await clickText(page, "Manage");
    await waitFor(page, () => bodyHas(page, "Edit, include"), "manage header");
    await clickText(page, "AI Analysis");
    await waitFor(page, () => bodyHas(page, "Analyze my portfolio"), "analyze CTA");
    if (!(await bodyHas(page, "Am I too dependent on one stock?"))) throw new Error("example questions missing");
  });

  await step("Privacy: export gives visible feedback (the silent-export regression)", async () => {
    await clickText(page, "Privacy");
    await waitFor(page, () => bodyHas(page, "Where your data lives"), "privacy header");
    await clickText(page, "Export everything");
    await waitFor(page, () => bodyHas(page, "Saved to sampatti-portfolio"), "export confirmation note");
  });

  await step("erase wipes the store completely", async () => {
    await clickText(page, "Erase all data");
    await sleep(150);
    await clickText(page, "Yes, erase all data");
    await sleep(500);
    const p = await store(page);
    if (p !== null && (p.accounts?.length || p.holdings?.length)) throw new Error("data survived the wipe");
    const caches = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("sampatti.")));
    if (caches.length > 0) throw new Error(`caches survived: ${caches.join(", ")}`);
  });

  await step("no uncaught page exceptions anywhere in the journey", async () => {
    if (pageErrors.length > 0) throw new Error(pageErrors.join(" | "));
  });

  console.log(`\nSmoke: ${passed} steps passed.`);
} finally {
  await browser.close();
  server.kill();
}
