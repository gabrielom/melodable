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
7. **No `localStorage`/`sessionStorage`** for persistence — use the Tauri store plugin or SQLite (M7). This includes the theme, despite the design brief asking for localStorage.

## Conventions

- Vue 3 Composition API with `<script setup lang="ts">`; Pinia for state; `@/` aliases `src/`.
- Design tokens live in **two places that must stay in step**: `src/styles.css` (CSS custom properties, for the DOM) and `src/engine/theme.ts` (the same values as data, because canvas can't read custom properties). Change one, change the other. Don't introduce a new palette. These now supersede the palette in `build_plan.html`, which predates the trainer redesign.
- Two themes, `dark` and `light`, swapped by `data-theme` on `<html>` from `settings.theme`. Light is one flat grey, so on-states **invert** to a dark chip and every field needs the `--outline` hairline — a lighter fill reads as nothing.
- Rating colors live in the palette: `PALETTE[theme].rating[r]` (`src/engine/theme.ts`). Renderers read that, never a hardcoded rating colour. Dark: perfect = cyan, great = blue, good = amber, miss = red.
- **A lesson is a finite run, not an endless loop.** The pattern plays
  `lesson.repeats` times (built-ins are 16 bars, 39-55s) and then ends; the run
  is scored as a whole, and clearing one clean run advances the library.
  `lessonRepeats` derives a count for imported clips that don't state one.
  The overview strip spans the whole run, which is what makes its viewport
  rectangle a meaningful slice rather than the entire width.
- Lane identity uses the fixed 8-colour LED set (`ledOf`/`ledUpcoming`), indexed by the lane's position on screen — not a hash of the pad number, so a lane keeps its colour between lessons. Notes still to come are the LED at 33% (`UPCOMING_ALPHA`).
- Respect `prefers-reduced-motion`; keep controls keyboard-focusable.
- **Everything lives in the one transport bar**, which is also the macOS titlebar (left padding clears the traffic lights). It is 34px tall with every control 20px, and stays a single row with nothing hidden. No second toolbar row, no in-stage header.
- **The window floor is what keeps the bar intact**: `minWidth` in `tauri.conf.json` is 1216, measured as the narrowest width where all 19 trainer controls fit at natural size with the longest built-in name ("Syncopated Groove", full at 1206px). The bar's 84px left inset and the device chip's 116px cap are both part of that budget, so re-measure whenever either moves. **Measure with a device connected** — in a plain browser the port list is empty and the chip reads "NO DEVICE" at 91px rather than its 116px cap, which understates the floor by 25px. Nothing drops out responsively any more — if you add a control, re-measure and raise the floor, don't start hiding things. The lesson title is the one elastic element (`flex: 0 1 auto; min-width: 0`) so an imported clip with a long name ellipsises instead of pushing controls off the edge.
- The bar carries **`data-tauri-drag-region="deep"`**, not the bare attribute. Tauri's shim walks up from the clicked node and stops at the first interactive element, so controls opt out of dragging by themselves; the bare form only catches direct hits on the header, which at this density is gaps and nothing else. Anything non-interactive that hangs off the bar — the dropdowns — needs `="false"` so a click on its own chrome doesn't drag the window. `-webkit-app-region` is Electron-only and does nothing here.
- Dragging also needs **`core:window:allow-start-dragging`** in `src-tauri/capabilities/default.json`. `core:default` does *not* include it, and the shim swallows the rejection, so the failure is silent and looks like a CSS problem: the window still moves on the click that focuses it (AppKit handles that one) and double-click-zoom still works (`internal-toggle-maximize` *is* in the default set). Don't drop that grant.
- Keep `-webkit-user-select: none` alongside the unprefixed rule. WKWebView only honours the plain property from Safari 17, and a live text selection beats the drag on the same mousedown.
- Don't add code for a future milestone "while you're there". If something is unused today, it doesn't belong in the tree.

## Where things stand

**M0–M6 are complete.** M6 (Ableton Link) shipped: `src-tauri/src/link.rs` behind the
`link` cargo feature, `useLink.ts`, a chain-icon toggle with a peers badge, and a
follower in `useTrainer` that drives tempo via `Transport.setBpm` and phase via
`Transport.anchorTo`. `docs/ableton-playalong.md` documents it, including the
MIDI-Clock alternative if CMake ever becomes a problem.

The **trainer redesign** has landed in two handoffs. Handoff 02 (turn 10) is the
current design and supersedes 01 wherever they disagree — note that its own
§§16-29 reverse several of its earlier sections, so read those last. Every
screen now has a drawn state: home, both instruments in both orientations, the
monitor, count-in, import, summary and the dropdowns.

Undrawn edge cases — no MIDI device connected, an empty lesson list, a failed
import — are **not designed**; ask before inventing them.

Two things were deliberately not built from handoff 02: the summary's "slow to
84" (§25 drops it) and its "drill snare" action, which would need a drill mode
that does not exist. The app icon's 16px variant is also not generated — §15
asks for hand-tuned geometry there rather than a mechanical downscale, so
`npm run icons` starts at 32px.

### Next up: M7 — persistence

From the plan: SQLite (or the Tauri store) for practice history — per-lesson bests,
streaks, a session log. Notes:

- Settings and the last lesson already persist through `src/stores/persist.ts`
  (Tauri store plugin). Invariant 7 still holds: no `localStorage`.
- `AdvanceTracker` (`src/engine/adaptive.ts`) already tracks the lesson-clear streak
  in memory — that is the natural thing to persist first.
- Don't reintroduce automatic tempo changes; tempo stays hand-set on the bar.
