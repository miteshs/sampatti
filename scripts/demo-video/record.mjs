// Region demo videos (1–2 min, narrated): drives the BUILT app in real Chrome through a
// scripted tour — welcome → region → demo → every feature — with an animated cursor, and
// lays per-scene narration (macOS `say`: Aman en-IN / Samantha en-US) over the screen
// recording. Privacy is the through-line of both scripts.
//
//   npm run build && node scripts/demo-video/record.mjs            # both regions
//   node scripts/demo-video/record.mjs --region US                 # one region
//
// Sync strategy: narration is generated FIRST; each scene's video runs exactly as long as
// its audio (plus a breath), holding the last frame — so A/V sync is exact by construction.
// Narration is synthesized sentence-by-sentence and stitched with real silence: Siri-quality
// voices (Aman) ignore both `-r` and `[[slnc]]`, so pace and pauses must be edited in, not
// asked for. No atempo speed-up — viewers flagged the old 172wpm-normalized track as rushed.
// Frames come from CDP Page.startScreencast (jpeg, ack'd per frame) and are assembled with
// ffmpeg's concat demuxer using real frame timestamps. Output: out/sampatti-demo-<region>.mp4
// (1920×1200 H.264 + AAC). Outputs are artifacts (gitignored); the scripts are the source.
//
//   node scripts/demo-video/record.mjs --pron-test   # audition brand-name pronunciations

import { spawn, execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "scripts", "demo-video", "out");
const PORT = 4713;
const URL_ = `http://localhost:${PORT}`;
const FROZEN_NOW = new Date("2026-06-11T12:00:00+05:30").getTime();
const ONLY = (() => { const i = process.argv.indexOf("--region"); return i > 0 ? process.argv[i + 1] : null; })();

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const c of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser",
  ]) if (existsSync(c)) return c;
  throw new Error("Chrome not found — set CHROME_PATH");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- narration ------------------------------------------------------------------
// Written to match what is ON SCREEN in each scene; region versions differ where the
// market does (demo size, brokers/CAS, tax pillars, persona).
const SCRIPTS = {
  IN: {
    voice: "Aman",
    rate: null, // Siri-quality voice: -r is ignored; its native pace is already conversational
    pronounce: "Sampatti", // en-IN phonology reads the 'a's as schwas — correct as written
    label: "india",
    regionChip: "India",
    scenes: {
      welcome: "This is Sampatti — all your money, in one private picture. There's no account and no cloud: everything lives on your own computer. Pick your market — India — and start with the built-in demo.",
      overview: "One click loads a realistic fourteen-crore portfolio. The Overview reads like a story: your net worth, what you own, what you owe — and plain-words verdicts on equity, liquidity and concentration, all computed on this device.",
      performance: "Performance shows eighteen months of real history — what actually grew, versus what you added. Zoom into any period, or break it down account by account, using genuine purchase costs — never guesses.",
      adddata: "Adding your own money is drag and drop. Spreadsheets parse right here — even your CAS PDF, password and all, never leaves this computer. Imports land in a review card; nothing is saved until you approve.",
      ai: "Want a second opinion? A SEBI-aware analyst reviews concentration, diversification, Indian tax planning and retirement. And here is the heart of the privacy story: only this compact brief is ever sent — you can read every line of it before anything leaves.",
      privacy: "The Privacy page spells the whole deal out: where your data lives, what leaves, and when. Export everything as a single file — or erase it all with one click. Gone means gone.",
      close: "Sampatti. Private portfolio analysis, made for India. Install it with Homebrew — and see your whole picture tonight.",
    },
  },
  US: {
    voice: "Samantha",
    rate: 150, // narration pace, not announcer pace
    // en-US reads "Sampatti" as "sam-PAT-ee" (cat-vowels). सम्पत्ति is "sum-PUTT-ee";
    // "Sumputty" gets Samantha there. Spoken text only — on-screen spelling is untouched.
    pronounce: "Sumputty",
    label: "us",
    regionChip: "United States",
    scenes: {
      welcome: "This is Sampatti — all your money, in one private picture. There's no account and no cloud: everything lives on your own computer. Pick your market — the United States — and start with the built-in demo.",
      overview: "One click loads a realistic two point three million dollar portfolio. The Overview reads like a story: your net worth, what you own, what you owe — and plain-words verdicts on equity, liquidity and concentration, all computed on this device.",
      performance: "Performance shows eighteen months of real history — what actually grew, versus what you added. Zoom into any period, or break it down account by account, using genuine purchase costs — never guesses.",
      adddata: "Adding your own money is drag and drop. Download the positions file from Schwab, Fidelity or Vanguard and drop it in — it parses right here and never leaves this computer. Imports land in a review card; nothing is saved until you approve.",
      ai: "Want a second opinion? A fiduciary-style analyst reviews concentration, diversification, capital-gains planning, wash sales, and four-oh-one-k versus Roth placement. And here is the heart of the privacy story: only this compact brief is ever sent — you can read every line before anything leaves.",
      privacy: "The Privacy page spells the whole deal out: where your data lives, what leaves, and when. Export everything as a single file — or erase it all with one click. Gone means gone.",
      close: "Sampatti. Private portfolio analysis, made for the United States. Download it free — and see your whole picture tonight.",
    },
  },
};

const SENTENCE_GAP = 0.45; // breath between sentences, edited in as real silence

function makeAudio(region, name, text) {
  const spoken = text.replaceAll("Sampatti", region.pronounce);
  const sentences = spoken.split(/(?<=[.!?])\s+/).filter(Boolean);
  const parts = sentences.map((s, i) => {
    const f = join(OUT, `${region.label}-${name}-s${i}.aiff`);
    const args = ["-v", region.voice];
    if (region.rate) args.push("-r", String(region.rate));
    execFileSync("say", [...args, "-o", f, s]);
    return f;
  });
  const wav = join(OUT, `${region.label}-${name}.wav`);
  const n = parts.length;
  const norm = parts.map((_, i) =>
    `[${i}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`);
  const gaps = parts.slice(1).map((_, i) =>
    `aevalsrc=0:d=${SENTENCE_GAP}:s=48000,aformat=sample_fmts=s16:channel_layouts=mono[g${i}]`);
  const seq = parts.map((_, i) => (i < n - 1 ? `[a${i}][g${i}]` : `[a${i}]`)).join("");
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    ...parts.flatMap((f) => ["-i", f]),
    "-filter_complex", [...norm, ...gaps].join(";") + `;${seq}concat=n=${2 * n - 1}:v=0:a=1[out]`,
    "-map", "[out]", wav,
  ]);
  const dur = parseFloat(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav,
  ]).toString().trim());
  return { file: wav, dur };
}

// ---------- cursor + page helpers --------------------------------------------------------
async function installCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById("demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "demo-cursor";
    Object.assign(c.style, {
      position: "fixed", left: "640px", top: "500px", width: "22px", height: "22px",
      borderRadius: "50%", background: "rgba(30,30,30,.78)", border: "2.5px solid #fff",
      boxShadow: "0 2px 10px rgba(0,0,0,.45)", zIndex: 999999, pointerEvents: "none",
      transition: "left .85s cubic-bezier(.3,.7,.25,1), top .85s cubic-bezier(.3,.7,.25,1), transform .18s ease",
      transform: "translate(-50%,-50%)",
    });
    document.body.appendChild(c);
  });
}

const findRect = (page, text, tags = "button, summary, a") =>
  page.evaluate(({ text, tags }) => {
    const el = [...document.querySelectorAll(tags)].find((e) => e.textContent?.includes(text));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { text, tags });

async function cursorTo(page, text, opts = {}) {
  const rect = await findRect(page, text, opts.tags);
  if (!rect) throw new Error(`demo cursor target not found: ${text}`);
  await page.evaluate((r) => {
    const c = document.getElementById("demo-cursor");
    c.style.left = `${r.x}px`; c.style.top = `${r.y}px`;
  }, rect);
  await sleep(950);
}

async function click(page, text, opts = {}) {
  await cursorTo(page, text, opts);
  await page.evaluate(({ text, tags }) => {
    const c = document.getElementById("demo-cursor");
    c.style.transform = "translate(-50%,-50%) scale(.62)";
    setTimeout(() => (c.style.transform = "translate(-50%,-50%) scale(1)"), 160);
    const el = [...document.querySelectorAll(tags)].find((e) => e.textContent?.includes(text));
    el?.click();
  }, { text, tags: opts.tags ?? "button, summary, a" });
  await sleep(650);
}

const park = async (page) => {
  await page.evaluate(() => {
    const c = document.getElementById("demo-cursor");
    if (c) { c.style.left = "1216px"; c.style.top = "648px"; }
  });
  await sleep(350);
};

const scroll = async (page, top, ms = 1200) => {
  await page.evaluate((t) => window.scrollTo({ top: t, behavior: "smooth" }), top);
  await sleep(ms);
};

async function endCard(page, region) {
  await page.evaluate((isUS) => {
    document.getElementById("demo-cursor")?.style.setProperty("display", "none");
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "fixed", inset: 0, zIndex: 999998, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: "1.1rem",
      background: "#f7f5f0", opacity: 0, transition: "opacity .8s ease",
      fontFamily: "'Fraunces Variable', Georgia, serif", color: "#262420", textAlign: "center",
    });
    d.innerHTML = `
      <div style="font-size:64px; line-height:1">सं</div>
      <div style="font-size:44px; font-weight:600">Sampatti</div>
      <div style="font-size:19px; max-width:560px; opacity:.75">All your money, in one private picture.<br/>Nothing leaves your computer.</div>
      <div style="font-family:ui-monospace,Menlo,monospace; font-size:15px; background:#262420; color:#f7f5f0; padding:.7rem 1.1rem; border-radius:10px; margin-top:.6rem">
        ${isUS ? "github.com/miteshs/sampatti-releases" : "brew tap miteshs/sampatti && brew trust miteshs/sampatti && brew install --cask sampatti"}
      </div>`;
    document.body.appendChild(d);
    requestAnimationFrame(() => (d.style.opacity = 1));
  }, region.label === "us");
}

// ---------- screencast (CDP) --------------------------------------------------------------
function startCapture(cdp, dir) {
  mkdirSync(dir, { recursive: true });
  const frames = []; // { file, ts }
  let n = 0;
  const onFrame = async (ev) => {
    const file = join(dir, `f${String(n++).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(ev.data, "base64"));
    frames.push({ file, ts: ev.metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", onFrame);
  return {
    frames,
    start: () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, everyNthFrame: 1 }),
    stop: async () => {
      await cdp.send("Page.stopScreencast").catch(() => {});
      cdp.off("Page.screencastFrame", onFrame);
    },
  };
}

// Build one scene mp4: frames (real timestamps) + narration, video exactly audioDur+pads.
const LEAD = 0.6, TAIL = 1.0; // settle-in / linger — scenes shouldn't slam into each other
function buildScene(region, name, frames, t0, audio) {
  const sceneDur = audio.dur + LEAD + TAIL;
  const listFile = join(OUT, `${region.label}-${name}.txt`);
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < frames.length; i++) {
    const start = Math.max(0, frames[i].ts - t0);
    const end = i + 1 < frames.length ? Math.max(start, frames[i + 1].ts - t0) : sceneDur;
    const dur = Math.max(0.02, Math.min(end, sceneDur) - start);
    lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(3)}`);
    if (end >= sceneDur) break;
  }
  lines.push(`file '${frames[frames.length - 1].file}'`); // concat quirk: repeat last
  writeFileSync(listFile, lines.join("\n"));
  const mp4 = join(OUT, `${region.label}-${name}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-i", audio.file,
    "-filter_complex",
    `[0:v]scale=1920:1200:flags=lanczos,format=yuv420p,fps=30[v];` +
    `[1:a]adelay=${Math.round(LEAD * 1000)}|${Math.round(LEAD * 1000)},apad,aresample=48000[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-crf", "20", "-preset", "medium",
    "-c:a", "aac", "-b:a", "160k",
    "-t", sceneDur.toFixed(3),
    mp4,
  ]);
  return mp4;
}

// ---------- the tour -----------------------------------------------------------------------
async function recordRegion(key, page, cdp) {
  const region = SCRIPTS[key];
  console.log(`\n▶ ${key} demo (voice: ${region.voice})`);
  const audio = {};
  for (const [name, text] of Object.entries(region.scenes)) audio[name] = makeAudio(region, name, text);

  // Fresh first-run, frozen clock already armed on the page.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1400);
  await installCursor(page);

  const sceneFiles = [];
  const scene = async (name, actions) => {
    const dir = join(OUT, `${region.label}-${name}-frames`);
    const cap = startCapture(cdp, dir);
    const t0 = Date.now() / 1000;
    await cap.start();
    await sleep(350); // first frame lands
    const budgetMs = (audio[name].dur + LEAD) * 1000;
    const start = Date.now();
    await actions();
    const left = budgetMs - (Date.now() - start);
    if (left > 0) await sleep(left);
    await sleep(350);
    await cap.stop();
    if (cap.frames.length === 0) throw new Error(`no frames for scene ${name}`);
    const first = cap.frames[0].ts;
    sceneFiles.push(buildScene(region, name, cap.frames, Math.min(first, t0 + 0.35), audio[name]));
    console.log(`  ✓ ${name} (${audio[name].dur.toFixed(1)}s narration, ${cap.frames.length} frames)`);
  };

  await scene("welcome", async () => {
    await sleep(900);
    await click(page, region.regionChip);
    await sleep(800);
    await cursorTo(page, "Load demo portfolio");
    await sleep(600);
    await park(page);
  });

  await scene("overview", async () => {
    await click(page, "Load demo portfolio");
    await sleep(900);
    await click(page, "Overview");
    await park(page);
    await sleep(1650); // hero count-up
    await scroll(page, 520, 1200);
    await sleep(1200);
    await scroll(page, 1040, 1200);
  });

  await scene("performance", async () => {
    await scroll(page, 0, 400);
    await click(page, "Performance");
    await park(page);
    await sleep(1150);
    await click(page, "1Y");
    await sleep(1300);
    await click(page, "All");
    await sleep(1300);
    await click(page, "By account");
    await park(page);
    await sleep(550);
    await scroll(page, 560, 1100);
  });

  await scene("adddata", async () => {
    await scroll(page, 0, 400);
    await click(page, "Add data");
    await park(page);
    await sleep(1050);
    await scroll(page, 420, 1100);
    await sleep(1500);
    await scroll(page, 860, 1100);
  });

  await scene("ai", async () => {
    await scroll(page, 0, 400);
    await click(page, "AI Analysis");
    await park(page);
    await sleep(1250);
    await scroll(page, 380, 1100);
    await sleep(1600);
    await scroll(page, 760, 1100);
  });

  await scene("privacy", async () => {
    await scroll(page, 0, 400);
    await click(page, "Privacy");
    await park(page);
    await sleep(1150);
    await scroll(page, 430, 1200);
    await sleep(900);
    await cursorTo(page, "Export everything");
    await sleep(700);
    await cursorTo(page, "Erase all data");
  });

  await scene("close", async () => {
    await scroll(page, 0, 350);
    await click(page, "Settings");
    await park(page);
    await sleep(1350);
    await endCard(page, region);
    await sleep(1200);
  });

  // Concat scenes (identical codecs → stream copy).
  const listFile = join(OUT, `${region.label}-all.txt`);
  writeFileSync(listFile, sceneFiles.map((f) => `file '${f}'`).join("\n"));
  const final = join(OUT, `sampatti-demo-${region.label}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", final]);
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).toString().trim());
  console.log(`✓ ${final} — ${dur.toFixed(1)}s`);
  return final;
}

// ---------- main -----------------------------------------------------------------------------
// Pronunciation can only be judged by ear: render the candidates and exit. Target is the
// Hindi सम्पत्ति — "sum-PUTT-ee", never "sam-PAT-ee".
if (process.argv.includes("--pron-test")) {
  mkdirSync(OUT, { recursive: true });
  for (const [voice, word] of [
    ["Aman", "Sampatti"], ["Aman", "Sumputty"],
    ["Samantha", "Sampatti"], ["Samantha", "Sumputty"], ["Samantha", "Sum putty"],
  ]) {
    const f = join(OUT, `pron-${voice}-${word.replaceAll(" ", "_")}.aiff`);
    execFileSync("say", ["-v", voice, "-o", f, `${word}. Private portfolio analysis. ${word}.`]);
    console.log(f);
  }
  process.exit(0);
}
rmSync(OUT, { recursive: true, force: true });
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
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(URL_)).ok) break; } catch { /* booting */ }
    await sleep(250);
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
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

  const cdp = await page.createCDPSession();
  for (const key of ["IN", "US"]) {
    if (ONLY && ONLY !== key) continue;
    await recordRegion(key, page, cdp);
  }
} finally {
  await browser.close();
  stopServer();
}
process.exit(0);
