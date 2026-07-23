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
| M3 — Adaptive difficulty + library | ⬜ next |
| M4 — Ableton MIDI import | ⬜ |
| M5 — Piano mode (falling notes) | ⬜ |
| M6 — Ableton Link play-along | ⬜ |
| M7 — Polish & package | ⬜ |

### What works right now

- Native MIDI input through Rust — device enumeration, connect/disconnect, live streaming.
- **Pads mode:** 4×4 MPC-style grid, synthesized drum kit, hit glow scaled by velocity.
- **Piano mode:** on-screen keyboard built on the real `keyGeometry()` mapping M5 will reuse.
- Play from hardware, mouse, or computer keyboard.
- **Falling-note trainer (pads):** transport with count-in, canvas lanes falling to a hit line, Perfect/Great/Good/Miss grading, accuracy + combo HUD, metronome, and an optional guide track.
- **Adaptive tempo:** clean bars nudge the BPM up (capped at 135% of base), rough bars ease it off (floored at 60%) — Melodics' Auto-BPM idea.
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

**Icons:** an `app-icon.png` is included. Generate the platform icon set once before `tauri build`:

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
│  └─ midi-clock.ts # midir timestamps -> AudioContext clock
├─ composables/   # useMidi.ts (Rust bridge), useTrainer.ts (session loop)
├─ stores/        # Pinia
├─ components/    # DevicePicker, MidiMonitor, Hud
├─ data/lessons/  # built-in lesson JSON
└─ views/
   ├─ pads/       # PadGrid.vue, PadLanes.ts (canvas lanes)
   └─ piano/      # PianoKeyboard.vue, mapping.ts  (+ PianoRoll.ts in M5)

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
