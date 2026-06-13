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
// Click a button by its exact aria-label (the Insights toggles share "On"/"Off" text, so
// plain clickText is ambiguous; the labels are unique).
const clickAria = (page, label) =>
  page.evaluate((label) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
    if (el) el.click();
    return !!el;
  }, label);

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

  await step("welcome region choice swaps the copy and persists", async () => {
    if (!(await bodyHas(page, "Where do you manage your money?"))) throw new Error("region question missing");
    await clickText(page, "United States");
    await waitFor(page, () => bodyHas(page, "401(k)s"), "US welcome copy");
    if (!(await bodyHas(page, "$2.3M portfolio"))) throw new Error("US demo footnote missing");
    await sleep(500); // persist debounce
    const us = await store(page);
    if (us.settings.country !== "US" || us.settings.baseCurrency !== "USD") {
      throw new Error(`region didn't persist: ${us.settings.country}/${us.settings.baseCurrency}`);
    }
    // Back to India — the rest of the journey runs the IN experience unchanged.
    await clickText(page, "India");
    await waitFor(page, () => bodyHas(page, "PF, FDs, property, gold"), "India welcome copy back");
    await sleep(500);
    const back = await store(page);
    if (back.settings.country !== "India" || back.settings.baseCurrency !== "INR") {
      throw new Error("region didn't switch back to India");
    }
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
    // Column sorting: click a header → desc arrow; again → asc. By-account keeps groups.
    await clickText(page, "Value");
    await waitFor(page, () => bodyHas(page, "▼"), "sort arrow desc");
    await clickText(page, "Value");
    await waitFor(page, () => bodyHas(page, "▲"), "sort arrow asc");
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

  await step("Developer mode gates AI engines; local gated off in web; toggle persists", async () => {
    await clickText(page, "Settings");
    await waitFor(page, () => bodyHas(page, "How analysis reaches Claude"), "settings tab");
    // The experimental card must not exist until developer mode is switched on.
    if (await bodyHas(page, "AI engines")) throw new Error("AI engines card visible without developer mode");
    await clickText(page, "Turn on developer mode");
    await waitFor(page, () => bodyHas(page, "heads-up before you switch this on"), "risk notice");
    if (await bodyHas(page, "AI engines")) throw new Error("card unlocked before the notice was confirmed");
    await clickText(page, "I understand — turn it on");
    await waitFor(page, () => bodyHas(page, "AI engines"), "AI engines card after enabling");
    await sleep(500); // persist debounce

    // Seed the persisted store as if a desktop user had chosen the on-device engine for
    // analysis — proves load()'s settings.ai migration/merge surfaces on the UI. The
    // reload also proves developerMode itself persisted (the card must come back).
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("sampatti.portfolio"));
      p.settings.ai = { extraction: "claude", analysis: "local" };
      localStorage.setItem("sampatti.portfolio", JSON.stringify(p));
    });
    await page.reload({ waitUntil: "networkidle2" });
    await clickText(page, "Settings");
    await waitFor(page, () => bodyHas(page, "AI engines"), "AI engines card (developer mode persisted)");
    await auditA11y(page, "Settings");
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
    await clickText(page, "Settings");
    await waitFor(page, () => bodyHas(page, "AI engines"), "AI engines card after reload");
    const after = await engineChip(page, "Portfolio analysis", "Claude");
    if (!after?.active) throw new Error("claude chip not active after reload");
  });

  await step("erase wipes the store completely", async () => {
    await clickText(page, "Privacy");
    await waitFor(page, () => bodyHas(page, "Erase all data"), "privacy data controls");
    await clickText(page, "Erase all data");
    await sleep(150);
    await clickText(page, "Yes, erase all data");
    await sleep(500);
    const p = await store(page);
    if (p !== null && (p.accounts?.length || p.holdings?.length)) throw new Error("data survived the wipe");
    const caches = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("sampatti.")));
    if (caches.length > 0) throw new Error(`caches survived: ${caches.join(", ")}`);
  });

  await step("US mode: demo figures agree across hero, loans line and brief (unit rule)", async () => {
    // Post-erase we're back on the welcome — run the US first-run experience for real.
    await clickText(page, "Add data");
    await waitFor(page, () => bodyHas(page, "Where do you manage your money?"), "welcome after erase");
    await clickText(page, "United States");
    await sleep(300);
    await clickText(page, "Load demo portfolio");
    await sleep(700);
    await clickText(page, "Overview");
    // The authored US-demo figures through the single display conversion. "$24K" here
    // would mean the double-divide returned; "$216" would mean no conversion at all.
    await waitFor(page, () => bodyHas(page, "$2.28M"), "US hero net worth");
    if (!(await bodyHas(page, "$2.69M you own"))) throw new Error("assets line disagrees with the hero");
    if (!(await bodyHas(page, "$410.0K in loans"))) throw new Error("loans line disagrees (the mangled-mortgage regression)");
    if (await bodyHas(page, "₹")) throw new Error("rupee symbol leaked into US mode's Overview");
    await auditA11y(page, "Overview-US");
    if (!(await bodyHas(page, "Private portfolio analysis · United States"))) throw new Error("header tag still says India");
    await clickText(page, "AI Analysis");
    await waitFor(page, () => bodyHas(page, "Tax-advantaged (401k/Roth/HSA)"), "US wrappers fact");
    if (!(await bodyHas(page, "$2.28M"))) throw new Error("facts panel disagrees with the hero");
    if (!(await bodyHas(page, "A top US financial analyst"))) throw new Error("analyst pitch still Indian");
    if (await bodyHas(page, "SEBI")) throw new Error("SEBI caveat leaked into US mode");
    // The user-reported repro: with US data loaded, Add data must offer the US demo.
    await clickText(page, "Add data");
    await waitFor(page, () => bodyHas(page, "Load demo portfolio ($2.3M)"), "US demo re-load button");
    if (await bodyHas(page, "₹14 Cr")) throw new Error("India demo label leaked into US mode");
  });

  await step("optional insights render; dark mode stays accessible", async () => {
    // Both insight features are opt-in (off by default) — turn them on and verify they render.
    await clickText(page, "Settings");
    await waitFor(page, () => bodyHas(page, "Insights"), "insights settings");
    if (!(await clickAria(page, "Portfolio health score"))) throw new Error("health-score toggle not found");
    await sleep(150);
    if (!(await clickAria(page, "Goals & retirement"))) throw new Error("goals toggle not found");
    await sleep(300);
    await clickText(page, "Overview");
    await waitFor(page, () => bodyHas(page, "Portfolio health"), "health card");
    if (!(await bodyHas(page, "/ 100"))) throw new Error("health score figure missing");
    await waitFor(page, () => bodyHas(page, "Are you on track?"), "retirement outlook card");
    if (!(await bodyHas(page, "your corpus could reach"))) throw new Error("retirement projection text missing");
    await auditA11y(page, "Overview-insights");

    // Opt-in dark mode — enable it and re-audit (axe otherwise only ever sees the light theme).
    await clickText(page, "Settings");
    await waitFor(page, () => bodyHas(page, "Appearance"), "appearance control");
    await clickText(page, "Dark");
    await sleep(250);
    if (!(await page.evaluate(() => document.documentElement.dataset.theme === "dark"))) {
      throw new Error("dark theme not applied to <html data-theme>");
    }
    await auditA11y(page, "Settings-dark");
    await clickText(page, "Overview");
    await sleep(250);
    await auditA11y(page, "Overview-dark");
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
