# Instructions for Claude Code

## The spec

**`build_plan.html`** in this repo is the authoritative spec — open and read it before writing code. It contains the architecture, data models, code sketches, the Melodics design study, and the M0–M7 milestone roadmap with acceptance criteria.

`PadTrainer.jsx` (if present) is a **behavior reference only** — a working React prototype of the transport, scoring, adaptive-tempo logic, and pad view. Port its *logic* into TypeScript in `src/engine/`; do not copy its React specifics or add React to this project.

## How to work

- **One milestone at a time.** M0 and M1 are already complete. Start at **M2**. Build it, stop, let me verify, then commit before moving on.
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

## Next up: M2 — Engine + pad view

From the plan:

> Tasks: transport (clock, loop, count-in), scoring, HUD (accuracy/combo), pad canvas lanes, one built-in pad lesson, Vitest tests for scoring/adaptive.
>
> **Done when:** falling notes hit the line in time; ratings and combo update; tests pass.

Expected new files: `src/engine/transport.ts`, `src/engine/scoring.ts`, `src/engine/adaptive.ts`, `src/views/pads/PadLanes.ts`, `src/components/Hud.vue`, `src/data/lessons/*.json`, plus tests.

Note that `NoteEvent`, `Lesson`, `TIMING_WINDOWS`, `RATING_SCORE`, and `RATING_COLOR` already exist in `src/engine/types.ts` — build on them rather than redefining.
