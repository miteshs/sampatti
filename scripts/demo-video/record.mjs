// Region tutorial videos (~2½ min, narrated): drives the BUILT app in real Chrome through
// a story-driven walkthrough — the viewer's problem → the private promise → every tab →
// how to switch the AI on (relay or your-own-key) → install. Privacy is the through-line.
// Narration: edge-tts neural voices via uvx (en-IN-Neerja / en-US-Jenny), falling back to
// macOS `say` (Aman / Samantha) when offline. Captions are burned in + .srt sidecars,
// because embedded videos autoplay muted. See TUTORIAL-PLAN.md for the standing critique.
//
//   npm run build && node scripts/demo-video/record.mjs            # both regions
//   node scripts/demo-video/record.mjs --region US                 # one region
//   node scripts/demo-video/record.mjs --tts say                   # force offline voices
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
// Tutorial voice, not tour voice: every scene tells the viewer what to DO ("open the
// Performance tab"), matches what is ON SCREEN, and the arc is problem → promise → every
// tab → switch the AI on → install. Region versions differ where the market does.
const SCRIPTS = {
  IN: {
    edgeVoice: "en-IN-NeerjaNeural",
    voice: "Aman", // `say` fallback
    rate: null, 
    pronounce: "Sampatti",
    label: "india",
    regionChip: "India",
    scenes: {
      welcome: "If your money lives in a dozen places—brokers, bank apps, EPF, and gold—you're not alone. Sampatti brings it all into one private picture, on your own computer. No cloud, no sign-up. Choose India, and let's load a demo to see how it feels.",
      overview: "The dashboard is your financial home. At a glance, you see your total net worth and where it sits. But the real value is in these verdicts—simple, plain-word reads on your equity and liquidity, computed entirely on this device.",
      performance: "Open the Performance tab to see what actually matters: did your money grow, or did you just add more? You can zoom into any period and see your history stacked account by account—built from real purchase costs, not guesses.",
      holdings: "The Holdings tab puts you in control. You can edit any holding, update prices, or exclude an account from your totals with a single click. To add your own numbers, just drop in a CAS PDF or spreadsheet. Everything parses right here, and you review every line before it's saved.",
      ai: "Now, the hero feature: AI Analysis. A SEBI-aware analyst reviews your diversification, tax planning, and retirement. Sampatti shows you the exact brief before it leaves—a private summary, never your raw statements.",
      settings: "In Settings, you can connect the AI Analyst. Just paste your secure access code to use our hosted relay. Your data stays on your device—only the compact brief is sent for review.",
      privacy: "Finally, the Privacy page is our contract. Gone means gone. One click erases everything. Export your data anytime. It's your wealth, and finally, it's your privacy.",
      close: "That's Sampatti. Modern, private portfolio analysis. Install it tonight and finally see the whole picture.",
    },
  },
  US: {
    edgeVoice: "en-US-JennyNeural",
    voice: "Samantha", // `say` fallback
    rate: 150,
    pronounce: "Sumputty",
    label: "us",
    regionChip: "United States",
    scenes: {
      welcome: "If your money is scattered across brokerages, retirement accounts, and the bank—you're not alone. Sampatti brings it all into one private picture, on your own computer. No cloud, no sign-up. Let's choose the United States and explore the demo.",
      overview: "This is your financial home. You see your total net worth and allocation at a glance. These verdicts on concentration and liquidity aren't generic advice—they're deterministic reads computed entirely on your device.",
      performance: "The Performance tab answers the big question: is your wealth actually growing? Zoom into any period to see your net worth history stacked by account—built from your real cost basis, never estimates.",
      holdings: "The Holdings tab gives you total control. Edit positions, refresh prices, or exclude an account from your dashboard in seconds. To add your own data, just drop in an export from Schwab or Fidelity. It parses locally, and you review everything in a secure card before it touches your portfolio.",
      ai: "For a deeper look, use the AI Analyst. It reviews your 401(k) placement, wash sales, and capital gains. You can read the exact summary before it leaves for analysis—privacy is the through-line.",
      settings: "In Settings, you can configure the AI Analyst. Just paste your secure access code to connect to the hosted relay. Your data stays on your device—only the compact brief is sent for review.",
      privacy: "The Privacy page is our absolute promise. Export everything as a single file, or erase it all with one click. In Sampatti, your financial life stays yours.",
      close: "That's Sampatti. The private way to see your whole net worth. Download it free tonight and meet your money.",
    },
  },
};

const SENTENCE_GAP = 0.55; // breath between sentences, edited in as real silence
const EDGE_RATE = "-8%";   // a touch below Jenny/Neerja's default — tutorial pace

// Engine choice: edge-tts neural voices when uvx + network are there, `say` offline.
// --tts say|edge overrides. Detected once; a mid-run network drop should fail loudly
// rather than silently produce a two-voice video.
const TTS = (() => {
  const i = process.argv.indexOf("--tts");
  const forced = i > 0 ? process.argv[i + 1] : null;
  if (forced === "say") return "say";
  try {
    execFileSync("uvx", ["edge-tts", "--version"], { stdio: "pipe", timeout: 30000 });
    return "edge";
  } catch {
    if (forced === "edge") throw new Error("--tts edge requested but uvx edge-tts is unavailable");
    console.warn("⚠ edge-tts unavailable — falling back to macOS `say` voices");
    return "say";
  }
})();

function ttsSentence(region, file, text) {
  if (TTS === "edge") {
    // The service occasionally drops a connection; one retry covers it.
    for (let attempt = 0; ; attempt++) {
      try {
        execFileSync("uvx", ["edge-tts", "--voice", region.edgeVoice, `--rate=${EDGE_RATE}`,
          "--text", text, "--write-media", file], { stdio: "pipe", timeout: 60000 });
        return;
      } catch (e) {
        if (attempt >= 1) throw e;
      }
    }
  }
  const args = ["-v", region.voice];
  if (region.rate) args.push("-r", String(region.rate));
  execFileSync("say", [...args, "-o", file, text]);
}

function makeAudio(region, name, text) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const ext = TTS === "edge" ? "mp3" : "aiff";
  const parts = sentences.map((s, i) => {
    const f = join(OUT, `${region.label}-${name}-s${i}.${ext}`);
    ttsSentence(region, f, s.replaceAll("Sampatti", region.pronounce));
    return f;
  });
  // Per-sentence durations drive both the stitch and the caption cues (original text in
  // the cues — viewers must read "Sampatti", whatever the engine was told to say).
  const probe = (f) => parseFloat(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f,
  ]).toString().trim());
  const partDur = parts.map(probe);
  const cues = [];
  let t = 0;
  sentences.forEach((s, i) => {
    cues.push({ text: s, start: t, end: t + partDur[i] });
    t += partDur[i] + SENTENCE_GAP;
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
  return { file: wav, dur: probe(wav), cues };
}

// ---------- captions ---------------------------------------------------------------------
const srtTime = (t) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

function writeSrt(file, cues) {
  writeFileSync(file, cues.map((c, i) =>
    `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n"));
}

const vttTime = (t) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

function writeVtt(file, cues) {
  writeFileSync(file, "WEBVTT\n\n" + cues.map((c, i) =>
    `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join("\n"));
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

// Scroll an element into the middle of the viewport — no pixel guesses, so the camera
// always shows what the narration is talking about (caught by the Settings scene, which
// clicked the relay chips below the fold while the viewer saw "Developer mode").
const scrollToEl = async (page, text, tags = "button, summary, a, h2, h3", ms = 1100) => {
  const found = await page.evaluate(({ text, tags }) => {
    const el = [...document.querySelectorAll(tags)].find((e) => e.textContent?.includes(text));
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }, { text, tags });
  if (!found) throw new Error(`scrollToEl target not found: ${text}`);
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
  console.log(`\n▶ ${key} demo (voice: ${TTS === "edge" ? region.edgeVoice : region.voice})`);
  const audio = {};
  for (const [name, text] of Object.entries(region.scenes)) audio[name] = makeAudio(region, name, text);

  // Fresh first-run, frozen clock already armed on the page.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1400);
  await installCursor(page);

  const sceneFiles = [];
  const allCues = [];
  let timelineT = 0; // running start of the current scene in the final cut — anchors captions
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
    for (const c of audio[name].cues) {
      allCues.push({ text: c.text, start: timelineT + LEAD + c.start, end: timelineT + LEAD + c.end });
    }
    timelineT += audio[name].dur + LEAD + TAIL;
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

  await scene("holdings", async () => {
    await scroll(page, 0, 400);
    await click(page, "Holdings");
    await park(page);
    await sleep(1500);
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

  await scene("settings", async () => {
    await scroll(page, 0, 400);
    await click(page, "Settings");
    await park(page);
    await sleep(1300);
    await scrollToEl(page, "AI analysis");
    await sleep(600);
    await cursorTo(page, "Access code", { tags: "label" });
    await sleep(1500);
    await scroll(page, 200, 1100);
    await sleep(1000);
  });

  await scene("privacy", async () => {
    await scrollToEl(page, "Privacy & data");
    await sleep(900);
    await cursorTo(page, "Export everything");
    await sleep(1000);
    await cursorTo(page, "Erase all data");
    await sleep(1000);
    await park(page);
  });

  await scene("close", async () => {
    await scroll(page, 0, 350);
    await click(page, "Overview");
    await park(page);
    await sleep(1400);
    await endCard(page, region);
    await sleep(1200);
  });

  // Concat scenes (identical codecs → stream copy), then one finishing pass: burn the
  // captions (embedded videos autoplay muted) and master loudness to -16 LUFS.
  const listFile = join(OUT, `${region.label}-all.txt`);
  writeFileSync(listFile, sceneFiles.map((f) => `file '${f}'`).join("\n"));
  const master = join(OUT, `${region.label}-master.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", master]);

  const srt = join(OUT, `sampatti-demo-${region.label}.srt`);
  writeSrt(srt, allCues);
  const vtt = join(OUT, `sampatti-demo-${region.label}.vtt`);
  writeVtt(vtt, allCues);

  const final = join(OUT, `sampatti-demo-${region.label}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", master,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-crf", "20", "-preset", "medium",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final,
  ]);
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).toString().trim());
  console.log(`✓ ${final} — ${dur.toFixed(1)}s (audio mastered + ${vtt.split("/").pop()} sidecar)`);

  // Auto-copy to the website assets folder (MP4 and VTT)
  const siteAssets = join(ROOT, "site", "assets");
  if (existsSync(siteAssets)) {
    execFileSync("cp", [final, join(siteAssets, `sampatti-demo-${region.label}.mp4`)]);
    execFileSync("cp", [vtt, join(siteAssets, `sampatti-demo-${region.label}.vtt`)]);
    console.log(`  ✓ Copied MP4 and VTT to site/assets/ for web hosting`);
  }

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
