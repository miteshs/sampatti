# Tutorial videos — PM critique & improvement plan

The videos are the product's main selling point. This doc is the standing critique and
the plan of record; update the iteration log as work lands.

## PM critique of the v2 cuts (2026-06-11, sha d5a0a67)

1. **Voice realism has a hard ceiling.** macOS `say` — even paced well — reads as
   synthetic, especially Samantha (en-US). Selling-point material can't sound budget.
2. **It's a tour, not a tutorial.** Narration *describes* ("Performance shows…") instead
   of *guiding* ("Open the Performance tab…"). A first-time user can't follow along.
3. **The hero feature has no setup story.** AI analysis is shown, but the video never
   says how to turn it on. Settings has the full answer (relay vs your-own-key, keychain
   storage) and the tour never opens it. A viewer finishes the video not knowing the
   first thing to do after install.
4. **Two of seven tabs are missing.** Manage never appears; Settings only flashes in the
   close scene. "See every tab" fails.
5. **No story arc.** Opens with a product assertion, not the viewer's problem (money
   scattered across a dozen apps). Problem → promise → setup → tour → trust → CTA.
6. **Sound-off viewers get nothing.** No captions; embedded videos autoplay muted.
7. **No audio mastering.** No loudness normalization, no fades.
8. **Process note:** videos are recorded from repo HEAD, the shipped dmg can lag (0.3.0
   dmg predates the Settings-tab split). Re-cut the dmg when videos and app must match.

## Plan of record

- **Voice**: edge-tts neural voices via `uvx` (free, no key) — en-IN-Neerja for India,
  en-US-Jenny for the US; both warm/friendly. `say` remains the offline fallback
  (`--tts say`). Neerja pronounces "Sampatti" natively; Jenny still gets the respell.
- **Script**: story-driven tutorial, instructional voice, all seven tabs, ~2½ min:
  problem hook → private promise → pick region → demo → Overview → Performance →
  Manage → Add data → AI (the brief) → **Settings: relay or your-own-key** → Privacy →
  install CTA.
- **Captions**: per-sentence timings fall out of the synthesis step → burned-in
  lower-thirds + `.srt` sidecar.
- **Mastering**: loudnorm to −16 LUFS in the final pass.
- **Pacing**: 0.55s sentence gaps; clicks land when the words say so.

## Iteration log

- [x] **It. 1 — videos**: neural TTS w/ fallback, tutorial rewrite, Manage + Settings
      scenes, captions + srt, loudnorm, re-record, replace release assets.
      - Frame-check caught the Settings scene narrating the relay while the viewport
        showed "Developer mode" — pixel-guess scrolls replaced with `scrollToEl()`
        (scrollIntoView), so the camera follows the narration by construction.
      - Measured length: ~4:00 IN / ~3:37 US. Longer than the 2½-min target but
        defensible for a follow-along tutorial; revisit with a tighter script read.
- [x] **It. 2 — UI/UX pass** (commit 70629d9): audit screenshots of all 14 tab views
      (audit-shots.mjs, kept); curated atlas PALETTE replaces the Tailwind-default
      rainbow in donut/stack/chips; hero-card grain + indigo→gold hairline; verdict
      margin-rules via scoped :has(); ground washes audible; cool greys warmed.
      336/336 tests pass. Videos re-recorded against the new UI (the Performance
      scene showed the old rainbow).
- [ ] **It. 3 — candidates**: a :60 teaser cut for the README (the 4-min tutorial is for
      committed viewers; the hook needs to be shorter); sync clicks to sentence-cue
      boundaries (makeAudio already returns per-sentence timings — actions could await
      the cue that names them); re-cut dmg so app matches videos; YouTube upload w/ srt;
      background music bed (only if it stays subtle).

## Known limitations (accepted for now)

- Recording drives the **web preview** in Chrome, so Settings shows the web-preview
  fine print ("kept in this tab's memory") while narration describes the desktop app
  (keychain). Tiny on-screen text; revisit only if we switch to driving the Tauri app.
