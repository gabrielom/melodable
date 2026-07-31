# Instructions for Claude Code

## The spec

**`build_plan.html`** in this repo is the authoritative spec — open and read it before writing code. It contains the architecture, data models, code sketches, the Melodics design study, and the M0–M7 milestone roadmap with acceptance criteria.

`PadTrainer.jsx` (if present) is a **behavior reference only** — a working React prototype of the transport, scoring, and pad view. Port its *logic* into TypeScript in `src/engine/`; do not copy its React specifics or add React to this project.

Note where the app has **deliberately diverged from the plan**: the plan's adaptive/Auto-BPM tempo ramp was removed — tempo is set by hand on the bar's slider. `adaptive.ts` now only tracks the lesson-clear streak. Don't reintroduce automatic tempo changes.

## How to work

- **One milestone at a time.** M0–M5 are already complete. Start at **M6**. Build it, stop, let me verify, then commit before moving on.
- Don't scaffold future milestones ahead of time. No placeholder files for M6–M7.
- After each milestone, state plainly what to click to verify it against the plan's acceptance criteria.
- Run `npm test` and `npm run build` before declaring a milestone done.

## Invariants — do not break these

1. **No Web MIDI.** Never call `navigator.requestMIDIAccess()`. Tauri renders in the OS webview (WebKit on macOS/Linux) which doesn't support it. All MIDI arrives from Rust as `midi://message` events via `src/composables/useMidi.ts`.
2. **`src/engine/` stays pure TypeScript.** No Vue imports, no DOM assumptions beyond Web Audio in `audio.ts`. Everything there must be unit-testable with Vitest. Add tests as you add logic.
3. **Grade timing against `MidiMessage.timestampMicros`** (from `midir`) and the `AudioContext` clock — never `Date.now()` or the moment a Vue handler happens to run.
4. **One engine, two views.** Pads and Piano must share the transport and scorer. They differ only in a renderer and a pitch→position mapping (`src/engine/pitch.ts`). If you find yourself duplicating scoring logic per instrument, stop and refactor.
5. **Keep the `midir` connection alive** in Tauri state (`MidiState` in `src-tauri/src/midi.rs`). Dropping it silently closes the port.
6. **Canvas for the falling-note lane**, driven by a single `requestAnimationFrame` loop reading the transport clock. Do not re-render Vue per frame.
7. **No `localStorage`/`sessionStorage`** for persistence — use the Tauri store plugin or SQLite (M7).

## Conventions

- Vue 3 Composition API with `<script setup lang="ts">`; Pinia for state; `@/` aliases `src/`.
- Design tokens live in `src/styles.css` and match `build_plan.html`. Reuse them; don't introduce a new palette.
- Rating colors: amber = perfect, teal = great, blue = good, red = miss (`RATING_COLOR` in `src/engine/types.ts`). Renderers must read `RATING_COLOR`, never hardcode a rating colour.
- Respect `prefers-reduced-motion`; keep controls keyboard-focusable.
- **Everything lives in the one transport bar**, which is also the macOS titlebar (`data-tauri-drag-region`, left padding clears the traffic lights). It must stay a single row down to ~1120px — measure it, don't assume. No second toolbar row, no in-stage header.
- Don't add code for a future milestone "while you're there". If something is unused today, it doesn't belong in the tree.

## Next up: M6 — Ableton Link play-along

From the plan:

> Tasks: `link.rs` (rusty_link, feature-flagged), `useLink`, "Follow Ableton" toggle, transport follows Link tempo + phase, peers indicator.
>
> **Done when:** with Ableton running Link, the trainer locks to its tempo and downbeat; changing tempo in Ableton moves the trainer.

Notes from M0–M5, already in place — build on these rather than redefining:

- **The transport is the integration point.** `src/engine/transport.ts` already re-anchors continuously on `setBpm(bpm, now)` (playhead stays put) and exposes `timeOfAbsBeat`. M6's Link follower drives `bpm` from Link tempo and aligns the loop's downbeat to Link phase — extend the transport with a phase/anchor setter rather than bolting on a parallel clock.
- Keep Link behind a cargo feature (`link` already stubbed in `src-tauri/Cargo.toml`) and a runtime toggle; the app must still build/run without it. `rusty_link` needs CMake — see build_plan.html §11b/§16.
- Rust→Vue events already flow through the same pattern as MIDI (`src/composables/useMidi.ts`): add `link://state` emission in `src-tauri/src/link.rs` and a `useLink.ts` composable, with a `LinkState` type (tempo/beat/phase/peers) defined *when you build it* — the speculative one was removed in the audit.
- **Warn the user (they asked about this):** a lighter alternative to Link is following Ableton's **MIDI Clock** over a virtual port — the MIDI bridge already exists; `src-tauri/src/midi.rs` currently filters clock via `Ignore::All`. `docs/ableton-playalong.md` lays out both paths. Confirm which they want before building.
- Two views share one engine (M5): the transport and scorer are instrument-agnostic, so Link work touches only the transport + a composable, not the renderers.
