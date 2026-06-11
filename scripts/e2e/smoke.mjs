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

// Find an engine chip on the Privacy "AI engines" card by its row label + chip label.
// Rows are <div><span>{row label}</span><button/><button/></div>; two rows share chip text,
// so plain clickText would always hit the extraction row.
const engineChip = (page, rowText, chipText, click = false) =>
  page.evaluate(({ rowText, chipText, click }) => {
    const row = [...document.querySelectorAll("div")].find((d) => {
      const f = d.firstElementChild;
      return f?.tagName === "SPAN" && f.textContent?.includes(rowText);
    });
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent?.includes(chipText));
    if (!btn) return null;
    if (click) btn.click();
    return { active: btn.className.includes("active"), disabled: btn.disabled };
  }, { rowText, chipText, click });

// Accessibility audit (axe-core, WCAG 2.0/2.1 A+AA). Serious/critical violations FAIL the
// smoke — this audience (45–65, non-technical) is exactly who a11y regressions hurt.
const AXE_SRC = join(ROOT, "node_modules", "axe-core", "axe.min.js");
const a11yIssues = [];
async function auditA11y(page, screenName) {
  // Let the view fade/stagger animations finish — axe computes contrast THROUGH the
  // mid-animation opacity and would flag the entire tab otherwise.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await sleep(120);
  await page.addScriptTag({ path: AXE_SRC });
  const result = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return r.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
      samples: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 120)),
    }));
  });
  for (const v of result) a11yIssues.push({ screen: screenName, ...v });
}

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
// detached → vite gets its own process group we can kill whole. Killing only the npx
// wrapper orphans the vite server underneath on linux, and its inherited pipe FDs keep
// this process's event loop alive forever — every quick-gates e2e job hung exactly there.
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "pipe", detached: true });
const stopServer = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); } };
process.on("exit", stopServer);

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
    await auditA11y(page, "Overview");
  });

  await step("Performance: stack, Measured card, By-account grouping", async () => {
    await clickText(page, "Performance");
    await waitFor(page, () => bodyHas(page, "Your portfolio, account by account"), "stack card");
    if (!(await bodyHas(page, "Measured"))) throw new Error("coverage card missing");
    await clickText(page, "By account");
    await waitFor(page, () => page.evaluate(() => /·\s*\d+ holdings?/.test(document.body.innerText)), "account subtotal header");
    await auditA11y(page, "Performance");
  });

  await step("Manage and AI Analysis render their key affordances", async () => {
    await clickText(page, "Manage");
    await waitFor(page, () => bodyHas(page, "Edit, include"), "manage header");
    await clickText(page, "AI Analysis");
    await waitFor(page, () => bodyHas(page, "Analyze my portfolio"), "analyze CTA");
    if (!(await bodyHas(page, "Am I too dependent on one stock?"))) throw new Error("example questions missing");
    await auditA11y(page, "Manage+Analysis");
  });

  await step("Privacy: export gives visible feedback (the silent-export regression)", async () => {
    await clickText(page, "Privacy");
    await waitFor(page, () => bodyHas(page, "Where your data lives"), "privacy header");
    await clickText(page, "Export everything");
    await waitFor(page, () => bodyHas(page, "Saved to sampatti-portfolio"), "export confirmation note");
    await auditA11y(page, "Privacy");
  });

  await step("AI engines card: local gated off in the web preview; engine toggle persists", async () => {
    // Seed the persisted store as if a desktop user had chosen the on-device engine for
    // analysis — proves load()'s settings.ai migration/merge surfaces on the UI.
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("sampatti.portfolio"));
      p.settings.ai = { extraction: "claude", analysis: "local" };
      localStorage.setItem("sampatti.portfolio", JSON.stringify(p));
    });
    await page.reload({ waitUntil: "networkidle2" });
    await clickText(page, "Privacy");
    await waitFor(page, () => bodyHas(page, "AI engines"), "AI engines card");
    if (!(await bodyHas(page, "available in the desktop app"))) throw new Error("web-preview model note missing");

    const local = await engineChip(page, "Portfolio analysis", "On this device");
    if (!local?.active) throw new Error("persisted local engine not reflected on the analysis chip");
    const extLocal = await engineChip(page, "Statement extraction", "On this device");
    if (extLocal?.disabled !== true) throw new Error("local chip should be disabled with no model (web/CI — nothing downloads here)");

    // Flip analysis back to Claude through the real chip and prove it persists.
    if (!(await engineChip(page, "Portfolio analysis", "Claude", true))) throw new Error("claude chip not found");
    await sleep(500); // persist debounce
    const p = await store(page);
    if (p.settings.ai?.analysis !== "claude") throw new Error(`toggle didn't persist: ${JSON.stringify(p.settings.ai)}`);
    await page.reload({ waitUntil: "networkidle2" });
    await clickText(page, "Privacy");
    await waitFor(page, () => bodyHas(page, "AI engines"), "AI engines card after reload");
    const after = await engineChip(page, "Portfolio analysis", "Claude");
    if (!after?.active) throw new Error("claude chip not active after reload");
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

  await step("accessibility: no serious/critical WCAG A/AA violations", async () => {
    const bad = a11yIssues.filter((v) => v.impact === "serious" || v.impact === "critical");
    const minor = a11yIssues.filter((v) => v.impact !== "serious" && v.impact !== "critical");
    if (minor.length) console.log(`    (a11y notes, non-blocking: ${minor.map((v) => `${v.screen}:${v.id}×${v.nodes}`).join(", ")})`);
    if (bad.length) {
      for (const v of bad) console.error(`    ${v.screen} ${v.id} samples:\n      ${v.samples.join("\n      ")}`);
      throw new Error(bad.map((v) => `${v.screen}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes} nodes)`).join(" | "));
    }
  });

  await step("no uncaught page exceptions anywhere in the journey", async () => {
    if (pageErrors.length > 0) throw new Error(pageErrors.join(" | "));
  });

  console.log(`\nSmoke: ${passed} steps passed.`);
} finally {
  await browser.close();
  stopServer();
}
process.exit(process.exitCode ?? 0); // stray handles must never outlive the verdict
