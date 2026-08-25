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
- **Two colour languages, and a note wears exactly one.** The **instrument hues** name a lane or a pitch — *what* to hit. The **rating** colours name a result — *how well*. They share no value, so a dimmed target can never be misread as a judgement. `noteInk` (`src/views/lane-geometry.ts`) is the single place that decides, and every renderer goes through it. The switch is `resolved`, not which side of the playhead a note is on: a note sitting on the playhead has no result yet. During the count-in nothing is judged, so everything shows its tint.
- Rating colors live in the palette: `PALETTE[theme].rating[r]` (`src/engine/theme.ts`). Renderers read that, never a hardcoded rating colour.
- **A lesson is a finite run, not an endless loop.** The pattern plays
  `lesson.repeats` times (built-ins are 16 bars, 39-55s) and then ends; the run
  is scored as a whole, and clearing one clean run advances the library.
  `lessonRepeats` derives a count for imported clips that don't state one.
  The overview strip spans the whole run, which is what makes its viewport
  rectangle a meaningful slice rather than the entire width.
- Lane identity is a **hue from the fourteen** (`hueOf`), indexed by the lane's position on screen — not by pad number or pitch, so a lane keeps its colour between lessons. Pads walk the list in order; piano starts on the cool end (blue, violet, bronze, teal) so a chord reads as separate voices. The **dimmed** value is derived, never authored: `mix(hue, field, 0.60)` in dark against `#0d0d0e`, `0.35` in light against `#cccccc`. That reproduces the design's own dimmed column for all fourteen in both themes, and `tests/theme.test.ts` pins it. A lane's strip, its lit mini-grid cell and its unplayed notes are all that same dim tint; full strength means the lane is sounding *now*. This supersedes the old 8-colour LED set, three of which doubled as rating colours.
- `--led0..2` in `styles.css` are **not** lane identity — they are chrome accents (the device dot, the resume flag, the monitor's source dots) and are deliberately not mirrored in `theme.ts`.
- Respect `prefers-reduced-motion`; keep controls keyboard-focusable.
- **A note can have a length.** `NoteEvent.duration` is in beats; anything under `HOLD_MIN_BEATS` is an ornament and normalised to zero by `lessonTargets`. A held note is judged twice and independently: the onset rating is unchanged and alone decides the colour, and the sustain is measured from the note's *written* onset so a late strike is not charged twice. Overholding is not an error — the fraction clamps at 1, and a hold still open at the written end closes itself, which is also what stops a controller that never sends note-off from scoring every hold as dropped. Combo breaks on a dropped hold, survives a short one. Pads carry no duration on import (a drum has decayed before you could let go), though the renderers support pad holds if a lesson authors them.
- **Everything lives in the one transport bar**, which is also the macOS titlebar (left padding clears the traffic lights). It is 34px tall with every control 20px, and stays a single row with nothing hidden. No second toolbar row, no in-stage header.
- **The window floor is what keeps the bar intact**: `minWidth` in `tauri.conf.json` is 1052, measured as the narrowest width where every trainer control fits at natural size with the longest built-in name ("Syncopated Groove", full at 1042px). It has come down from 1216 in three steps as controls left the trainer bar for home — the instrument switch (handoff 05 §4.2), then the import button, then the Ableton Link toggle (handoff 08). The trainer bar is still the binding one; home needs about 650. **A plain browser understates this floor, and the trap has bitten twice:** the device chip reads "NO DEVICE" at 91px rather than its 116px cap (−25px), and the Link toggle does not render at all outside a Tauri build with the `link` feature — that one no longer affects the floor now Link is home-only, but it still affects any measurement of the *home* bar. `scratchpad/floor2.mjs` forces the chip; the template needs a temporary `v-if` widening for the toggle. The bar's 84px left inset is part of the budget too, so re-measure whenever any of it moves. Nothing drops out responsively any more — if you add a control, re-measure and raise the floor, don't start hiding things. The lesson title is the one elastic element (`flex: 0 1 auto; min-width: 0`) so an imported clip with a long name ellipsises instead of pushing controls off the edge.
- The bar carries **`data-tauri-drag-region="deep"`**, not the bare attribute. Tauri's shim walks up from the clicked node and stops at the first interactive element, so controls opt out of dragging by themselves; the bare form only catches direct hits on the header, which at this density is gaps and nothing else. Anything non-interactive that hangs off the bar — the dropdowns — needs `="false"` so a click on its own chrome doesn't drag the window. `-webkit-app-region` is Electron-only and does nothing here.
- Dragging also needs **`core:window:allow-start-dragging`** in `src-tauri/capabilities/default.json`. `core:default` does *not* include it, and the shim swallows the rejection, so the failure is silent and looks like a CSS problem: the window still moves on the click that focuses it (AppKit handles that one) and double-click-zoom still works (`internal-toggle-maximize` *is* in the default set). Don't drop that grant.
- Keep `-webkit-user-select: none` alongside the unprefixed rule. WKWebView only honours the plain property from Safari 17, and a live text selection beats the drag on the same mousedown.
- **App icons**: `npm run icons` renders the PNGs full-bleed for Windows/Linux and builds `icon.icns` inset to Apple's grid (824 of 1024). macOS needs that inset or the icon renders visibly larger than every other app in the Dock; the other platforms don't. In `tauri dev` on macOS there is no `.app`, so the Dock icon comes from the icns embedded into the binary by `generate_context!` — `src-tauri/build.rs` carries a `rerun-if-changed=icons` because tauri-build doesn't emit one, and without it an icon change never recompiles and the old artwork stays baked in.
- **The bar's icons are SVG paths, not characters.** Volume, import and Ableton Link carry path data copied verbatim from handoff 08. They were a system glyph (`⇪`) and hand-built curves before, and that is exactly why they drifted from the drawings — a character is at the mercy of the font stack and the platform's rasteriser. **Do not substitute a font character, an emoji, an icon-set component, or rebuild the curves from `border-radius`.** They ink from `currentColor`, which `.ico` sets to `--txt2` — the same value handoff 08 names for both themes.
- **Home-bar-only controls**: the instrument switch, the Ableton Link toggle and the import button. All three are decisions made *before* a run — what to play, what is plugged in, what is in the library — and the trainer bar is the one that is tight for width. Link stays joined once you start; there is simply no toggle mid-run.
- **Bar tooltips are `data-tip`, never `title`.** WKWebView's native tooltip is not dependable in the titlebar — late, often absent, sometimes a flash — so `BarTooltip.vue` draws them from one delegated listener. A control opts in by carrying the attribute. **Do not leave `title` on the same element**: the platform would draw its own on top, which is the thing being replaced. `data-tip` is a tooltip and not a name, so a glyph-only button still needs its own `aria-label`. Dialogs and the monitor keep plain `title` — they are ordinary page content and behave normally.
- Don't add code for a future milestone "while you're there". If something is unused today, it doesn't belong in the tree.

## Where things stand

**M0–M6 are complete.** M6 (Ableton Link) shipped: `src-tauri/src/link.rs` behind the
`link` cargo feature, `useLink.ts`, a chain-icon toggle with a peers badge, and a
follower in `useTrainer` that drives tempo via `Transport.setBpm` and phase via
`Transport.anchorTo`. `docs/ableton-playalong.md` documents it, including the
MIDI-Clock alternative if CMake ever becomes a problem.

**Link aligns to the peer's downbeat, not to session phase.** Phase only names a
boundary of *some* quantum, and Ableton's quantum is one bar while ours is the
lesson loop — so for a two-bar lesson half of Ableton's downbeats are not
boundaries of ours and we land a bar out at even odds. `link.rs` enables
start/stop sync and reports `beatsSinceStart`, the beats from the peer's
transport start; `linkBeat` prefers it and falls back to `phase` only when no
peer publishes a transport (Live's "Start Stop Sync" is off by default). Don't
go back to phase-only alignment.

**With a peer on the session, Start arms rather than starts.** Link carries the
peer's loop *length* nowhere, so counting our own loops from anywhere still
lands inside a longer one — every built-in lesson is 1 or 2 bars, and against a
4-bar Ableton loop that is bar 1, 2, 3 or 4 at the mercy of when Start was
pressed. Their transport start is the one downbeat Link names outright, so
`Transport.startAt` pins beat 0 to a time derived from it. Derived, not equal:
**Live turns Link's transport on when its count-in starts, not when bar 1 does**,
and Link says neither which it is nor how long a count-in runs — so ours runs
over theirs and beat 0 lands one of *our* count-ins later. That assumes their
count-in is a bar, like ours; it is the one guess left in this path, and it is
the user's own configuration. While armed the count-in screen holds with empty
rings and a `waiting` caption. Don't replace this with
a guessed alignment unit, and don't add a bars-per-cycle setting without asking
— that option was offered and declined.

Two more rules hang off the alignment: `Transport.start`
takes a `StartGrid` so beat 0 is *pinned* rather than yanked into place a frame
later — the yank was up to half a loop and ate the count-in it landed in — and
once the run proper is under way the follower only trims drift
(`LINK_MAX_TRIM_BEATS`), because teleporting a playing lesson would score the
player against notes they never saw. `tests/link-sync.test.ts` simulates a
session and pins all of it.

The **trainer redesign** has landed across several handoffs. **Handoff 05 (turn
11) is the current design** and supersedes everything before it where they
disagree; 02 (turn 10) still governs anything 05 does not mention, and its own
§§16-29 reverse several of its earlier sections, so read those last. Every
screen has a drawn state: home, both instruments in both orientations, the
monitor, count-in, import, summary and the dropdowns.

Handoff 05 is built: sustained notes end to end (model, importer, scorer,
input, and the bar drawn in all four views), the fourteen instrument hues with
the target/result colour split, the 33px overview strip, and the instrument
switch moved to the home bar. Three deliberate divergences, each argued in the
code where it bites:

- The design's **34px minimum bar** is a scrolling-axis figure. Applied
  verbatim it makes a hold undrawable in the falling views, whose time axis
  has a third of the pixels — yet `11c` and `11f` plainly draw them, against a
  roll where a beat is ~32px rather than our ~16. The falling axis uses a
  structural floor instead (`holdFloor`). **This is the one number here that is
  ours, not the design's** — worth settling with them.
- **§1.5 vs §1.4** on whether a bar may cross the playhead in pads horizontal.
  §1.4 wins; hiding the bar around the crossing would flicker.
- The piano pitch→hue order follows §2.2's *prose* (1st blue, 2nd violet, 3rd
  bronze, 4th teal). The frames disagree with the prose **and with each other**
  — `11e` gives G4 steel and C5 indigo, `11f` gives G4 violet — so they are not
  usable as the source here.

Not built from 05, and worth asking about: `11a` draws the pad-layout panel
with a third `1x8` layout and right-aligned row hints, neither of which the
prose asks for; and the app's home bar still carries the volume and monitor
buttons that `11a` does not draw (which predates this handoff).

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

### After M7: M8 — the intermittent input delay

Parked deliberately until everything else is built, because it is a
troubleshooting milestone and not a feature: **do not start it early, and do not
"fix" it in passing while working on something else.**

The report, twice, in the user's words: *"there is once again a delay when I am
playing the notes, sometimes it happens. sometimes not."*

What is known:

- **The render loop is not the cause.** Measured with a worker posting messages
  into the running app at an irregular cadence — the same shape of arrival a
  MIDI event has. It waits 2-4ms at p99 to be picked up, in all four views, and
  no frame exceeded 32ms. The probe lives in the scratchpad as `inputlag.mjs`;
  rebuild it from that description if it is gone.
- An earlier round of this was "fixed" by cutting per-frame canvas cost and the
  user confirmed the delay went. Given the measurement above, treat that as
  unexplained rather than as a precedent — it may have been coincidence.

**Start with data, not with a fix.** Nothing in the app currently reveals what
the MIDI path is doing, and a whole commit of plausible-sounding changes was
written and reverted for exactly that reason. The first step is a throwaway
instrument: log every incoming message's kind and its arrival gap
(`audio.now` minus the midir timestamp mapped through `HostClock`) while the
user plays the way that provokes it. That separates the three cases at once —
what the controller actually sends and how fast, whether note-ons are arriving
late, and whether they arrive on time but sound late.

Unverified candidates, to check against that data rather than to act on first:

- `midir`'s `Ignore::All` only filters sysex, clock and active sensing.
  Aftertouch and pitch bend come through, and they are continuous — a
  pressure-sensitive pad reports for as long as it is held. Every message costs
  a serialization, a hop to the app's main thread and an `evaluateJavaScript`
  into the webview, and a note-on waits behind that queue. If it is this, thin
  the stream; **do not drop those messages — the user wants aftertouch.**
- `pushLog` does a reactive write and rebuilds a 60-element array for every
  message, including with the monitor closed and nothing mounted to read it.
- `triggerPad`/`noteOn` `await ensureAudio()` before sounding the voice, and an
  `await` yields even on an already-resolved promise, so the voice is scheduled
  a microtask after the handler returns.

Ask the user which it is — the sound arriving late, or the flash and the grade —
before assuming. The two have different causes.
