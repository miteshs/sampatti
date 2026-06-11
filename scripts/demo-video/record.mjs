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
    rate: null, // Siri-quality voice: -r is ignored; its native pace is already conversational
    pronounce: "Sampatti", // Indian-English phonology reads the 'a's as schwas — correct as written
    label: "india",
    regionChip: "India",
    scenes: {
      welcome: "If you're like most of us, your money lives in a dozen places — brokers, mutual-fund apps, EPF, the bank. Sampatti brings all of it into one private picture, on your own computer. No account, no cloud, nothing to sign up for. Let's set it up together. Choose your market — India — and load the demo portfolio, so you can explore before adding anything of your own.",
      overview: "The demo loads a realistic fourteen-crore portfolio, and you land on the Overview. At the top, your net worth. Below it, what you own and what you owe. And these plain-word verdicts — equity, liquidity, concentration — are computed entirely on this device. This is the picture you'll see every time you open the app.",
      performance: "Next, open the Performance tab. It answers the question that actually matters: did your money grow, or did you just add more? Pick any period — one year, or everything. Then break it down account by account, built from genuine purchase costs, never guesses.",
      manage: "The Manage tab keeps you in control. Edit any account or holding, pause one out of the totals, or remove it completely. You can also see how fresh every price is, and refresh them whenever you like.",
      adddata: "When you're ready for your own numbers, open Add data. Drag in a broker spreadsheet — or your CAS PDF, password and all. Everything parses right here on your computer. Each import lands in a review card, and nothing is saved until you approve it.",
      ai: "Now, the part everyone asks about: AI analysis. A SEBI-aware analyst reviews your concentration, diversification, tax planning and retirement. And before anything is sent, Sampatti shows you the exact brief that will leave your machine — a compact summary, never your raw data. You can read every line of it first.",
      settings: "To switch the AI on, open Settings. There are two ways. The relay is the easiest — ask us for access on GitHub, and your analysis flows through it without you handling any keys. Or, for maximum privacy, choose your own Anthropic key: paste a key from console.anthropic.com, and it's stored in your system keychain — it never even enters the app's web view.",
      privacy: "Finally, the Privacy page is the whole contract in plain words: what stays on your machine, what can leave, and when. Export everything as a single file whenever you like — or erase it all with one click. Gone means gone.",
      close: "That's Sampatti — your whole financial picture, private by design. Install it with Homebrew tonight, load the demo, and meet your money.",
    },
  },
  US: {
    edgeVoice: "en-US-JennyNeural",
    voice: "Samantha", // `say` fallback
    rate: 150, // narration pace, not announcer pace
    // en-US reads "Sampatti" as "sam-PAT-ee" (cat-vowels). सम्पत्ति is "sum-PUTT-ee";
    // "Sumputty" gets both Jenny and Samantha there. Spoken text only — on-screen
    // spelling is untouched, and captions show the real name.
    pronounce: "Sumputty",
    label: "us",
    regionChip: "United States",
    scenes: {
      welcome: "If you're like most of us, your money lives in a dozen places — brokerages, retirement accounts, the bank. Sampatti brings all of it into one private picture, on your own computer. No account, no cloud, nothing to sign up for. Let's set it up together. Choose your market — the United States — and load the demo portfolio, so you can explore before adding anything of your own.",
      overview: "The demo loads a realistic two-point-three-million-dollar portfolio, and you land on the Overview. At the top, your net worth. Below it, what you own and what you owe. And these plain-word verdicts — equity, liquidity, concentration — are computed entirely on this device. This is the picture you'll see every time you open the app.",
      performance: "Next, open the Performance tab. It answers the question that actually matters: did your money grow, or did you just add more? Pick any period — one year, or everything. Then break it down account by account, built from genuine purchase costs, never guesses.",
      manage: "The Manage tab keeps you in control. Edit any account or holding, pause one out of the totals, or remove it completely. You can also see how fresh every price is, and refresh them whenever you like.",
      adddata: "When you're ready for your own numbers, open Add data. Download the positions file from Schwab, Fidelity or Vanguard, and drop it in. Everything parses right here on your computer. Each import lands in a review card, and nothing is saved until you approve it.",
      ai: "Now, the part everyone asks about: AI analysis. A fiduciary-style analyst reviews concentration, diversification, capital-gains planning, wash sales, and four-oh-one-k versus Roth placement. And before anything is sent, Sampatti shows you the exact brief that will leave your machine — a compact summary, never your raw data. You can read every line of it first.",
      settings: "To switch the AI on, open Settings. There are two ways. The relay is the easiest — ask us for access on GitHub, and your analysis flows through it without you handling any keys. Or, for maximum privacy, choose your own Anthropic key: paste a key from console.anthropic.com, and it's stored in your system's credential manager — it never even enters the app's web view.",
      privacy: "Finally, the Privacy page is the whole contract in plain words: what stays on your machine, what can leave, and when. Export everything as a single file whenever you like — or erase it all with one click. Gone means gone.",
      close: "That's Sampatti — your whole financial picture, private by design. Download it free tonight, load the demo, and meet your money.",
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

  await scene("manage", async () => {
    await scroll(page, 0, 400);
    await click(page, "Manage");
    await park(page);
    await sleep(2200);
    await scrollToEl(page, "Data freshness");
    await sleep(1400);
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

  await scene("settings", async () => {
    await scroll(page, 0, 400);
    await click(page, "Settings");
    await park(page);
    await sleep(1300);
    await scrollToEl(page, "How analysis reaches Claude");
    await sleep(600);
    await cursorTo(page, "Relay (default, easiest)");
    await sleep(1500);
    await click(page, "My own Anthropic key");
    await sleep(1300);
    await cursorTo(page, "Save key");
    await sleep(900);
    await park(page);
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

  const final = join(OUT, `sampatti-demo-${region.label}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", master,
    "-vf", `subtitles=${srt}:force_style='FontName=Helvetica,FontSize=12,PrimaryColour=&H00FFFFFF,BackColour=&H66000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=30,Alignment=2'`,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-crf", "20", "-preset", "medium",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final,
  ]);
  const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).toString().trim());
  console.log(`✓ ${final} — ${dur.toFixed(1)}s (captions burned + ${srt.split("/").pop()} sidecar)`);
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
