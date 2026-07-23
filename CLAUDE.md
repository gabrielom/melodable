# Instructions for Claude Code

## The spec

**`build_plan.html`** in this repo is the authoritative spec — open and read it before writing code. It contains the architecture, data models, code sketches, the Melodics design study, and the M0–M7 milestone roadmap with acceptance criteria.

`PadTrainer.jsx` (if present) is a **behavior reference only** — a working React prototype of the transport, scoring, adaptive-tempo logic, and pad view. Port its *logic* into TypeScript in `src/engine/`; do not copy its React specifics or add React to this project.

## How to work

- **One milestone at a time.** M0–M3 are already complete. Start at **M4**. Build it, stop, let me verify, then commit before moving on.
- Don't scaffold future milestones ahead of time. No placeholder files for M4–M7.
- After each milestone, state plainly what to click to verify it against the plan's acceptance criteria.
- Run `npm test` and `npm run build` before declaring a milestone done.

## Invariants — do not break these

1. **No Web MIDI.** Never call `navigator.requestMIDIAccess()`. Tauri renders in the OS webview (WebKit on macOS/Linux) which doesn't support it. All MIDI arrives from Rust as `midi://message` events via `src/composables/useMidi.ts`.
2. **`src/engine/` stays pure TypeScript.** No Vue imports, no DOM assumptions beyond Web Audio in `audio.ts`. Everything there must be unit-testable with Vitest. Add tests as you add logic.
3. **Grade timing against `MidiMessage.timestampMicros`** (from `midir`) and the `AudioContext` clock — never `Date.now()` or the moment a Vue handler happens to run.
4. **One engine, two views.** Pads and Piano must share the transport, scorer, and adaptive logic. They differ only in a renderer and a pitch→position mapping. If you find yourself duplicating scoring logic per instrument, stop and refactor.
5. **Keep the `midir` connection alive** in Tauri state (`MidiState` in `src-tauri/src/midi.rs`). Dropping it silently closes the port.
6. **Canvas for the falling-note lane**, driven by a single `requestAnimationFrame` loop reading the transport clock. Do not re-render Vue per frame.
7. **No `localStorage`/`sessionStorage`** for persistence — use the Tauri store plugin or SQLite (M7).

## Conventions

- Vue 3 Composition API with `<script setup lang="ts">`; Pinia for state; `@/` aliases `src/`.
- Design tokens live in `src/styles.css` and match `build_plan.html`. Reuse them; don't introduce a new palette.
- Rating colors: amber = perfect, teal = great, blue = good, red = miss (`RATING_COLOR` in `src/engine/types.ts`).
- Respect `prefers-reduced-motion`; keep controls keyboard-focusable.

## Next up: M4 — Ableton MIDI import (pads)

From the plan:

> Tasks: SMF parser, import dialog, GM→pad mapping, generate a Lesson from a `.mid`.
>
> **Done when:** a drum clip exported from Ableton becomes a playable, gradable lesson at its own tempo.

Notes from M0–M3, already in place — build on these rather than redefining:

- The engine lives in `src/engine/`: `transport.ts`, `scoring.ts` (lane-based `Scorer`, `lessonTargets`), `adaptive.ts` (`nextTempo`, `AdvanceTracker`), `midi-clock.ts`. All unit-tested in `tests/`.
- `src/composables/useTrainer.ts` owns the session and reads the active lesson from the **lessons store** (`src/stores/lessons.ts`), which holds the list + current index and does select/advance. M4's importer should append its `Lesson` to that store's `lessons` array and select it.
- Built-in lessons are JSON in `src/data/lessons/` (`index.ts` loader). The `Lesson.notes` are **pitch-based** (`NoteEvent.pitch` = MIDI/GM note); `noteToPad` in `gm.ts` routes them to pad lanes. The importer must emit the same shape — put the SMF parser in `src/engine/midi-file.ts` (pure TS, unit-tested). `reference-prototype.jsx` has a working `parseMidi`/`midiToLesson` to port.
- Settings + last lesson persist via the Tauri store plugin (`src/stores/persist.ts`, `tauri-plugin-store`) — no localStorage (invariant 7).
- Ableton play-along (external sound) already works; see `docs/ableton-playalong.md`.
