# Rhythm Trainer

A Melodics-style timing trainer for **MPC-style pads** and **piano**, where lessons come from your own Ableton clips and you can play along to a live Ableton set — Ableton makes the sound, Melodable shows the notes and scores your timing.

**Stack:** Tauri 2 (Rust) · Vue 3 + TypeScript · `midir` for native MIDI · Web Audio · `rusty_link` (M6)

> 📄 **The full spec is [`build_plan.html`](./build_plan.html)** — open it in a browser. It contains the architecture, data models, the Melodics design study, and the M0–M7 roadmap. This README only covers getting the current code running.

---

## Status

| Milestone | State |
|---|---|
| **M0 — Scaffold** | ✅ done |
| **M1 — MIDI input** | ✅ done |
| **M2 — Engine + pad view** | ✅ done |
| **M3 — Lesson progression + library** | ✅ done |
| **M4 — Ableton MIDI import** | ✅ done |
| **M5 — Piano mode (falling notes)** | ✅ done |
| **M6 — Ableton Link play-along** | ✅ done |
| M7 — Practice history (persistence) | ⬜ next |

The **trainer redesign** (two handoffs) has also landed: light + dark themes, a
34px transport bar, five bars of music on screen, and every screen drawn.

### What works right now

- Native MIDI input through Rust — device enumeration, connect/disconnect, live streaming.
- **Home screen → trainer:** pick a lesson, practise it, and the **✕** in the transport bar takes you back.
- **One transport bar** doubling as the macOS titlebar: play/stop, tempo, guide, click, note direction, instrument, live score, device menu, sound source, import, volume, monitor toggle.
- **Pads mode:** only the pads the lesson actually uses, each showing its place on the controller — **4×4** (MPC) or **2×8** (Launchkey and other two-row controllers), picked from the chevron on the *Pads* button.
- **Piano mode:** falling notes aligned to an on-screen keyboard (at least three octaves, pinned to the bottom), poly synth, chord grading — the same transport and scorer as pads.
- **Two note directions:** vertical (notes fall to a hit line) or horizontal (Melodics-style, scrolling right-to-left onto a playhead). Both keep an "already played" zone so a note stays visible after you strike it.
- Play from hardware, mouse, or computer keyboard.
- **Grading:** a four-ring count-in, then **Perfect / Great / Early / Late / Miss** against fixed timing windows. The loose band splits by *direction*, so rushing and dragging read differently — and the end-of-run summary tells you which way each lane drifts.
- **A lesson is a finite run, not an endless loop.** Every built-in is 16 bars (39–55s); it plays through and ends, and the whole run is scored.
- **End-of-run summary:** the score, a breakdown bar across all five ratings, and your weakest lanes with the direction they drift.
- **Run overview:** the whole run at a glance above the lane, one dot per note, with a rectangle marking exactly the slice the lanes are showing.
- **Two themes**, dark (Maschine-style chassis) and light (one flat Ableton grey), from the toggle in the bar. Follows the OS on first run.
- **Lesson progression:** six built-in pad lessons (Four on the Floor → Tom Fill) plus a piano lesson; one clean run at/above the lesson's base tempo clears it and advances to the next. Tempo itself is yours to set — the readout you drag, not an algorithm.
- **Ableton Link:** lock tempo and downbeat to a live Ableton set from the chain toggle in the bar.
- **Persistent settings:** volume, sound source, metronome, monitor state, pad layout, note direction, and last lesson are saved via the Tauri store plugin (in-app only; browser dev stays in-memory).
- **Ableton clip import:** drop in a `.mid` clip and it becomes a gradable lesson at its own tempo — native SMF parser (tempo/time-signature meta, running status), auto-detects drums→pads / melodic→piano (overridable), and a preview dialog.
- **Two instruments, one engine:** pads and piano share the transport and scorer; they differ only in a canvas renderer and a pitch→lane map. Switching instrument jumps to that instrument's lesson.
- Hardware hits are graded at their `midir` timestamp mapped onto the audio clock, not at event-delivery time.
- **MIDI monitor** — live log of every message with note number, velocity, channel, and delta time; collapsible from the bar.
- Unit tests for the engine and pitch layer (transport, scoring, advancement, MIDI clock, SMF import) — `npm test`.

---

## Prerequisites

- **Rust** (stable) — https://rustup.rs
- **Node 18+**
- **Tauri system deps** — https://tauri.app/start/prerequisites
  - macOS: Xcode Command Line Tools
  - Windows: MSVC Build Tools + WebView2
  - Linux: `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, plus `libasound2-dev` and `pkg-config` for ALSA MIDI
- **CMake 3.14+** — needed only for Ableton Link, which `rusty_link` compiles from C++. `brew install cmake`, or see *Run it* below for the installer-only route and for building without Link.

## Run it

```bash
npm install
npm run tauri dev
```

First run compiles the Rust side and takes a few minutes; after that it's fast and hot-reloads the Vue side.

**No CMake?** Ableton Link is behind a cargo feature, so you can drop it:

```bash
npm run tauri dev -- -- --no-default-features
```

Both `--` are load-bearing. The first gets the rest past npm; the second tells
the Tauri CLI that what follows is for cargo, not for itself — with only one,
Tauri tries to parse the flag and rejects it. Pass that flag **and nothing
else**: adding `--features link` turns Link back on and you need CMake again.

Everything else works; the chain toggle just hides itself.

Without Homebrew, CMake also ships its own macOS installer: download the
universal `.dmg` from <https://cmake.org/download/>, drag `CMake.app` to
`/Applications`, then
`sudo "/Applications/CMake.app/Contents/bin/cmake-gui" --install` to put it on
your PATH.

**Browser-only** — `npm run dev` renders the UI at http://localhost:1420 for quick styling. MIDI, Ableton Link and persistence all need the Tauri shell.

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
2. Click the **▶ arm** button in the bar (browsers block audio until a gesture).
3. Click a pad and press `z` — you should hear a kick both ways.
4. Plug in your MPC / keyboard, open the **device menu** in the bar (it rescans on open) and pick your port.
5. Play — pads light up, notes sound, and the monitor fills with messages.
6. Switch to **Piano** and play your keyboard; keys light up in amber.

**Acceptance (from the plan):** hitting a pad/key produces sound with no audible lag, and the device picker lists ports.

> If your controller's pads light the wrong cells, read the note numbers in the MIDI monitor and extend `GM_TO_PAD` in `src/engine/gm.ts`. That map is also what M4's Ableton import uses.

## Verifying M2

1. `npm run tauri dev`, open a pad lesson.
2. Hit **▶ Play** — you get a one-bar count-in (4·3·2·1 over the lanes), then notes travel toward the hit line in the kick/snare/closed-hat lanes.
3. Strike pads (hardware, keys `z`/`x`/`a`, or mouse) as notes land. Notes ahead of the playhead carry their lane's colour; once struck they take their rating (green/cyan/amber/pink, red for a miss), keep travelling, and fade out at the edge.
4. Leave a bar unplayed — those notes turn miss-red and accuracy drops.
5. Toggle **Guide** to hear the target part quietly; drag the **tempo** readout mid-run — the playhead stays continuous.

**Acceptance (from the plan):** falling notes hit the line in time; ratings and combo update; `npm test` passes.

## Verifying M3

1. `npm run tauri dev`. The **home screen** lists every lesson; pick one and the trainer opens on it (tempo, hint, and lanes update). The **✕** in the bar returns to the list.
2. Hit **▶ START** and play well. The lesson runs 16 bars and then **ends** on a summary; one clean run at/above the lesson's base tempo **clears it and advances** to the next.
3. Change the volume or the **Synth/DAW** switch, quit, relaunch — your choice (and the last lesson) is **restored**. (Persistence only applies in the Tauri app, not `npm run dev`.)

**Acceptance:** clearing a lesson advances the progression; the home screen switches lessons; settings (including the theme) survive a relaunch.

## Verifying M4

1. In Ableton, drag a **MIDI drum clip** out to the desktop (or right-click → *Export MIDI Clip*).
2. `npm run tauri dev`, click the **⇪ import** button in the bar and pick the `.mid`.
3. The **import preview** shows the detected tempo, length, hit count, and which pads it uses, and flags whether it reads as a drum clip. Adjust the name/tempo if you like, then **Add to library**.
4. The clip becomes the current lesson (marked *imported* on the home screen) — hit **▶ Play** and drill it at its own tempo, graded like any built-in.

**Acceptance (from the plan):** a drum clip exported from Ableton becomes a playable, gradable lesson at its own tempo.

## Verifying M5

1. `npm run tauri dev`; click **Piano** in the bar — it loads the built-in *First Chords* lesson (falling notes over the keyboard).
2. Hit **▶ Play**: notes fall to the hit line and land on their keys; play them (MIDI keyboard, or `a s d f g h j k` = C major) — keys flash by rating and the bar tracks accuracy/combo. The lesson ends on a **C-major chord** (three notes at once); play all three to grade them independently.
3. Import a **melodic** `.mid` (a bass line or riff from Ableton): the import dialog auto-selects **Piano** and lists the keys used. Add it and play it.
4. Toggle **Pads** ↔ **Piano**: the view, keyboard/grid, and lesson switch together. The two note-direction icons swap between falling and scrolling in either instrument.

**Acceptance (from the plan):** a melodic clip imports as a piano lesson; falling notes align to the correct keys; chords grade correctly.

> Imported lessons live for the session. If a controller or Drum Rack sends note numbers the grid doesn't know, the importer places them on spare pads rather than dropping them; extend `GM_TO_PAD` in `src/engine/gm.ts` to place them deliberately.

## Verifying M6

1. In Ableton: **Settings → Link / Tempo / MIDI → Link: On**.
2. `npm run tauri dev`, then click the **chain icon** in the bar (left of the device menu). It turns teal and shows a peer count.
3. Hit **▶ START** — the run rides Ableton's grid. **Change Ableton's tempo and the trainer follows.** Dragging Melodable's tempo readout pushes tempo the other way.

**Acceptance (from the plan):** with Ableton running Link, the trainer locks to its tempo and downbeat.

### Playing along with Ableton (sound from Ableton, tracking in Melodable)

Set the bar's **Synth / DAW** switch to **DAW** and Melodable mutes its own
synth while still grading every hit — your controller plays Ableton's
instruments, Melodable shows the falling notes and scores your timing. The MIDI
routing (macOS) and current limits are written up in
[`docs/ableton-playalong.md`](./docs/ableton-playalong.md).

---

## Layout

```
src/
├─ engine/        # framework-agnostic core — never imports Vue
│  ├─ types.ts    # Lesson, NoteEvent, MidiMessage, ratings + colours
│  ├─ gm.ts       # pad layout (4x4 / 2x8), GM drum map, keyboard bindings
│  ├─ pitch.ts    # note names + keyboard geometry (shared by every view)
│  ├─ audio.ts    # Web Audio drum kit + piano voice + metronome
│  ├─ theme.ts    # the palette as data (canvas can't read CSS variables)
│  ├─ transport.ts # the playhead: clock math, count-in, run length, scheduler
│  ├─ scoring.ts  # lane-based grading, combo, run tally + per-lane drift
│  ├─ adaptive.ts # lesson-clear streak
│  ├─ host-clock.ts # midir / Link timestamps -> AudioContext clock
│  └─ midi-file.ts  # SMF parser + .mid → Lesson (Ableton import)
├─ composables/   # useMidi, useLink (Rust bridges), useTrainer (session loop)
├─ stores/        # Pinia: settings, lessons, persist (Tauri store)
├─ components/    # HomeScreen, DeviceMenu, MidiMonitor, ImportDialog, RunSummary
├─ data/lessons/  # built-in lesson JSON
└─ views/
   ├─ lane-frame.ts    # shared LaneRenderer contract (pads + piano)
   ├─ lane-geometry.ts # five-bar zoom, tempo grid, veil, count-in — shared
   ├─ Overview.ts      # the run-at-a-glance strip above the lane
   ├─ pads/       # PadLanes.ts (canvas lanes, both directions)
   └─ piano/      # PianoKeyboard.vue, PianoRoll.ts (canvas lanes, both directions)

src-tauri/src/
├─ main.rs        # Tauri builder, state, command registration
├─ midi.rs        # midir input → `midi://message` events
└─ link.rs        # Ableton Link → `link://state` events (feature-gated)
```

### Two rules worth keeping

1. **Never use `navigator.requestMIDIAccess()`.** Tauri renders in the OS webview (WebKit on macOS/Linux), which has no Web MIDI. All MIDI comes from Rust.
2. **Keep `src/engine/` pure TypeScript** with test coverage. It's the heart of the app — transport, scoring, pitch mapping, and MIDI-file import all live there and must be testable without a DOM.

---

## Troubleshooting

**No MIDI devices listed** — Some OSes hold a device exclusively; close other DAWs (including Ableton) or use a virtual port. On Linux, confirm ALSA sees it: `aconnect -l`.

**Port opens then goes silent** — The `midir` connection must stay alive in Tauri state. It's parked in `MidiState` in `midi.rs`; don't let it drop.

**Audio but no visuals (or vice versa)** — Check the monitor's source dots: amber = hardware, blue = computer keyboard, grey = mouse.

**`tauri dev` fails in `rusty_link`** — that's CMake missing. Install it, or build without Ableton Link: `npm run tauri dev -- -- --no-default-features` (two `--`, see *Run it*).

**`error: unexpected argument '--no-default-features' found`** — that's the Tauri CLI trying to parse a cargo flag. It needs the second `--`.

**Browser-only dev** — `npm run dev` renders the UI in a browser for quick styling, but MIDI, Ableton Link and persistence need the Tauri shell; the device menu says so when you open it outside Tauri.
