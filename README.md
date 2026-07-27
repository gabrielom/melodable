# Rhythm Trainer

A Melodics-style timing trainer for **MPC-style pads** and **piano**, where lessons come from your own Ableton clips, difficulty adapts to you, and you can play along locked to a live Ableton set via Ableton Link.

**Stack:** Tauri 2 (Rust) · Vue 3 + TypeScript · `midir` for native MIDI · Web Audio · `rusty_link` (M6)

> 📄 **The full spec is [`build_plan.html`](./build_plan.html)** — open it in a browser. It contains the architecture, data models, the Melodics design study, and the M0–M7 roadmap. This README only covers getting the current code running.

---

## Status

| Milestone | State |
|---|---|
| **M0 — Scaffold** | ✅ done |
| **M1 — MIDI input** | ✅ done |
| **M2 — Engine + pad view** | ✅ done |
| **M3 — Adaptive difficulty + library** | ✅ done |
| **M4 — Ableton MIDI import** | ✅ done |
| **M5 — Piano mode (falling notes)** | ✅ done |
| M6 — Ableton Link play-along | ⬜ next |
| M7 — Polish & package | ⬜ |

### What works right now

- Native MIDI input through Rust — device enumeration, connect/disconnect, live streaming.
- **Pads mode:** 4×4 MPC-style grid, synthesized drum kit, hit glow scaled by velocity.
- **Piano mode:** Synthesia-style falling notes aligned to an on-screen keyboard, poly synth, chord grading — same transport/scorer/adaptive engine as pads.
- Play from hardware, mouse, or computer keyboard.
- **Falling-note trainer (pads):** transport with count-in, canvas lanes falling to a hit line, Perfect/Great/Good/Miss grading, accuracy + combo HUD, metronome, and an optional guide track.
- **Adaptive tempo:** clean bars nudge the BPM up (capped at 135% of base), rough bars ease it off (floored at 60%) — Melodics' Auto-BPM idea.
- **Lesson progression + library:** six built-in pad lessons (Four on the Floor → Tom Fill); clearing one (two strong bars at/above base tempo) advances to the next, and the lesson library (click the lesson name) switches to any lesson.
- **Persistent settings:** volume, instrument, sound source, metronome, and last lesson are saved via the Tauri store plugin (in-app only; browser dev stays in-memory).
- **Ableton clip import:** drop in a `.mid` clip and it becomes a gradable lesson at its own tempo — native SMF parser (tempo/time-signature meta, running status), auto-detects drums→pads / melodic→piano (overridable), and a preview dialog.
- **Two instruments, one engine:** pads and piano share the transport, scorer, and adaptive tempo; they differ only in a canvas renderer and a pitch→lane map. Switching the mode toggle jumps to that instrument's lesson.
- Hardware hits are graded at their `midir` timestamp mapped onto the audio clock, not at event-delivery time.
- **MIDI monitor** — live log of every message with note number, velocity, channel, and delta time.
- Unit tests for the mapping layer and the engine (transport, scoring, adaptive, MIDI clock) — `npm test`.

---

## Prerequisites

- **Rust** (stable) — https://rustup.rs
- **Node 18+**
- **Tauri system deps** — https://tauri.app/start/prerequisites
  - macOS: Xcode Command Line Tools
  - Windows: MSVC Build Tools + WebView2
  - Linux: `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, plus `libasound2-dev` and `pkg-config` for ALSA MIDI
- **CMake 3.14+** — only needed from M6 onward (building Ableton Link)

## Run it

```bash
npm install
npm run tauri dev
```

First run compiles the Rust side and takes a few minutes; after that it's fast and hot-reloads the Vue side.

```bash
npm test          # vitest
npm run build     # type-check + build frontend
npm run tauri build   # package installers (see icons note below)
```

**Icons:** the generated platform icon set is committed in `src-tauri/icons/`, so
`tauri dev` and `tauri build` work out of the box. (Tauri reads these at *compile*
time — without them the Rust build fails in `generate_context!`, not just at
packaging.) To regenerate from a new source image:

```bash
npm run tauri icon app-icon.png
```

---

## Verifying M1

1. `npm run tauri dev`
2. Click **Enable audio** (browsers block audio until a gesture).
3. Click a pad and press `z` — you should hear a kick both ways.
4. Plug in your MPC / keyboard, hit **⟳**, pick it from the MIDI IN dropdown.
5. Play — pads light up, notes sound, and the monitor fills with messages.
6. Switch to **Piano** and play your keyboard; keys light up in amber.

**Acceptance (from the plan):** hitting a pad/key produces sound with no audible lag, and the device picker lists ports.

> If your controller's pads light the wrong cells, read the note numbers in the MIDI monitor and extend `GM_TO_PAD` in `src/engine/gm.ts`. That map is also what M4's Ableton import uses.

## Verifying M2

1. `npm run tauri dev`, stay in **Pads** mode.
2. Hit **▶ Play** — you get a one-bar count-in (4·3·2·1 over the lanes), then notes fall to the hit line in the kick/snare/closed-hat lanes.
3. Strike pads (hardware, keys `z`/`x`/`a`, or mouse) as notes land — notes recolor by rating (amber/teal/blue, red-ish for a miss), a rating pops on the pad, and the HUD's accuracy/combo update.
4. Leave a bar unplayed — everything turns miss-red and the **BAR** readout drops; with **Adapt tempo** on, the BPM eases off (and pushes up when you play clean).
5. Toggle **Guide sound** to hear the target part quietly; drag **Tempo** mid-run — the playhead stays continuous.

**Acceptance (from the plan):** falling notes hit the line in time; ratings and combo update; `npm test` passes.

## Verifying M3

1. `npm run tauri dev`, Pads mode.
2. Click the **lesson name** (top-left, e.g. *Four on the Floor 1/6*) — the **library** opens listing all six lessons. Pick one; the trainer switches to it (tempo, hint, and lanes update). ↑/↓ + Enter and Esc also work.
3. Hit **▶ Play** and play well — a clean bar pushes the tempo up; two strong bars at/above the base tempo **clear the lesson and advance** to the next one (a toast names it).
4. Play badly and watch the tempo **ease back down**.
5. Change the volume or the SOUND switch, quit, relaunch — your choice (and the last lesson) is **restored**. (Persistence only applies in the Tauri app, not `npm run dev`.)

**Acceptance (from the plan):** tempo eases/pushes by bar accuracy; clearing a lesson advances; library switches lessons.

## Verifying M4

1. In Ableton, drag a **MIDI drum clip** out to the desktop (or right-click → *Export MIDI Clip*).
2. `npm run tauri dev`, Pads mode, click **⇪ Import MIDI** in the toolbar and pick the `.mid`.
3. The **import preview** shows the detected tempo, length, hit count, and which pads it uses, and flags whether it reads as a drum clip. Adjust the name/tempo if you like, then **Add to library**.
4. The clip becomes the current lesson (marked *imported* in the library) — hit **▶ Play** and drill it at its own tempo, graded like any built-in.

**Acceptance (from the plan):** a drum clip exported from Ableton becomes a playable, gradable lesson at its own tempo.

## Verifying M5

1. `npm run tauri dev`; click **Piano** in the header — it loads the built-in *First Chords* lesson (falling notes over the keyboard).
2. Hit **▶ Play**: notes fall to the hit line and land on their keys; play them (MIDI keyboard, or `a s d f g h j k` = C major) — keys flash by rating and the HUD tracks accuracy/combo. The lesson ends on a **C-major chord** (three notes at once); play all three to grade them independently.
3. Import a **melodic** `.mid` (a bass line or riff from Ableton): the import dialog auto-selects **Piano** and lists the keys used. Add it and play it.
4. Toggle **Pads** ↔ **Piano**: the view, keyboard/grid, and lesson switch together.

**Acceptance (from the plan):** a melodic clip imports as a piano lesson; falling notes align to the correct keys; chords grade correctly.

> Imported lessons live for the session. If a controller or Drum Rack sends note numbers the grid doesn't know, the importer places them on spare pads rather than dropping them; extend `GM_TO_PAD` in `src/engine/gm.ts` to place them deliberately.

### Playing along with Ableton (sound from Ableton, tracking in Melodable)

Set the toolbar's **SOUND** switch to **Ableton / DAW** and Melodable mutes its
own synth while still grading every hit — your controller plays Ableton's
instruments, Melodable shows the falling notes and scores your timing. The MIDI
routing (macOS) and current limits are written up in
[`docs/ableton-playalong.md`](./docs/ableton-playalong.md).

---

## Layout

```
src/
├─ engine/        # framework-agnostic core — never imports Vue
│  ├─ types.ts    # Lesson, NoteEvent, MidiMessage, ratings, LinkState
│  ├─ gm.ts       # pad layout, GM drum map, keyboard bindings
│  ├─ audio.ts    # Web Audio drum kit + piano voice + metronome
│  ├─ transport.ts # looped playhead: clock math, count-in, scheduler window
│  ├─ scoring.ts  # lane-based hit grading, combo, per-loop accuracy
│  ├─ adaptive.ts # Auto-BPM tempo steps + lesson-clear streak
│  ├─ midi-clock.ts # midir timestamps -> AudioContext clock
│  └─ midi-file.ts  # SMF parser + .mid → Lesson (Ableton import)
├─ composables/   # useMidi.ts (Rust bridge), useTrainer.ts (session loop)
├─ stores/        # Pinia: settings, lessons, persist (Tauri store)
├─ components/    # DevicePicker, MidiMonitor, Hud, LessonLibrary, ImportDialog
├─ data/lessons/  # built-in lesson JSON
└─ views/
   ├─ lane-frame.ts # shared LaneRenderer contract (pads + piano)
   ├─ pads/       # PadGrid.vue, PadLanes.ts (canvas lanes)
   └─ piano/      # PianoKeyboard.vue, mapping.ts, PianoRoll.ts (falling notes)

src-tauri/src/
├─ main.rs        # Tauri builder, state, command registration
└─ midi.rs        # midir input → `midi://message` events
```

### Two rules worth keeping

1. **Never use `navigator.requestMIDIAccess()`.** Tauri renders in the OS webview (WebKit on macOS/Linux), which has no Web MIDI. All MIDI comes from Rust.
2. **Keep `src/engine/` pure TypeScript** with test coverage. It's the heart of the app — transport, scoring, adaptive difficulty, and MIDI-file import all live there and must be testable without a DOM.

---

## Troubleshooting

**No MIDI devices listed** — Some OSes hold a device exclusively; close other DAWs (including Ableton) or use a virtual port. On Linux, confirm ALSA sees it: `aconnect -l`.

**Port opens then goes silent** — The `midir` connection must stay alive in Tauri state. It's parked in `MidiState` in `midi.rs`; don't let it drop.

**Audio but no visuals (or vice versa)** — Check the monitor's source dots: amber = hardware, blue = computer keyboard, grey = mouse.

**Browser-only dev** — `npm run dev` renders the UI in a browser for quick styling, but MIDI needs the Tauri shell. The header badge shows which you're in.
