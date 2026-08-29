# Instructions for Claude Code

## The spec

**`build_plan.html`** in this repo is the authoritative spec — open and read it before writing code. It contains the architecture, data models, code sketches, the Melodics design study, and the M0–M7 milestone roadmap with acceptance criteria.

`PadTrainer.jsx` (if present) is a **behavior reference only** — a working React prototype of the transport, scoring, and pad view. Port its *logic* into TypeScript in `src/engine/`; do not copy its React specifics or add React to this project.

Note where the app has **deliberately diverged from the plan**: the plan's adaptive/Auto-BPM tempo ramp was removed — tempo is set by hand on the bar's slider. `adaptive.ts` now only tracks the lesson-clear streak. Don't reintroduce automatic tempo changes.

## How to work

- **One milestone at a time.** M0–M7 — the plan's whole roadmap — are complete, and nothing is queued behind them. Work from here is whatever I ask for next: build it, stop, let me verify, then commit before moving on.
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
- **The run-history chart fills its axis at any count.** `stepFor` divides the
  number of attempts, not `MAX_ATTEMPTS`: six runs span the same width as
  twenty-eight, oldest at the left and this run hard right. It used to divide
  the capacity so the spacing never changed and dots marched rightwards, which
  left a short history huddled in the left fifth of an empty chart. The trade
  is that the chart rescales as history accumulates — a dot moves when the next
  run lands — and that is accepted, not overlooked. It also retires the
  label-collision rule: `THIS RUN` is now always hard right, so the centred
  attempt count can never be pushed aside.
- **Sheet is a third trainer mode, not a third instrument** (handoff 10 §1).
  `ROLL | SHEET` swaps the renderer under the same transport and scorer —
  invariant 4 still holds, and `SheetStaff` is a renderer plus a pitch→staff
  mapping like the other two. It is **horizontal only** (notation has no
  vertical form, so the `↓` control is disabled, not hidden) and **piano
  only**: a treble staff read by pitch with a keyboard under it says nothing
  about a drum pad, and no percussion staff was ever drawn. Six of the seven
  built-ins are pads, so for most of the library the pair is simply absent —
  `sheetAvailable` is the gate.
- **Notation comes from Noto Music, vendored in `src/assets/fonts`** — never
  drawn by hand and never fetched from a CDN. Two numbers are measured off the
  font binary rather than estimated, and `tests/notation.test.ts` pins both: a
  notehead is `0.252em` tall (so `fontSize = staffSpace / 0.252`) and its
  centre sits `0.134em` above the alphabetic baseline. Replace the font and
  re-measure; do not assume they carry over. **Canvas cannot wait for a
  webfont** — `ctx.font` falls back silently and the frame is already painted
  — so `useNotationFont` loads it and the sheet renderer is not built until it
  is in.
- **What the font does not give you, and what to do instead** (§1.4): the
  augmentation dot is a combining mark with no advance width, so it is drawn;
  there is no beam glyph, and the stemmed glyphs carry their own flags, so a
  beamed group is assembled from bare heads, stems and beams; and every
  stemmed glyph is stem-**up**, which the frames accept. A **chord shares one
  stem** — drawing each note's own glyph stacks a stem per head and reads as a
  smear, which matters because the only piano built-in is called First Chords.
- **Sheet's zoom is derived, not fixed.** §1.7 leaves it open: at 60px per beat
  a sixteenth falls 15px after its neighbour while a notehead is 19px wide.
  `sheetPxPerBeat` keeps the roll's five bars unless the lesson's closest pair
  would collide, then zooms in until it clears — so nothing is ever drawn
  colliding and nothing zooms further than it must.
- The **window floor stays 1052** after adding the `ROLL | SHEET` pair. It was
  re-measured, per the rule above: the piano-plus-sheet bar fits at 1026px,
  inside the existing floor, because the floor is set by the longest *pads*
  title ("Syncopated Groove") and pads never show the pair.
- **The bar's icons are SVG paths, not characters.** Volume, import and Ableton Link carry path data copied verbatim from handoff 08. They were a system glyph (`⇪`) and hand-built curves before, and that is exactly why they drifted from the drawings — a character is at the mercy of the font stack and the platform's rasteriser. **Do not substitute a font character, an emoji, an icon-set component, or rebuild the curves from `border-radius`.** They ink from `currentColor`, which `.ico` sets to `--txt2` — the same value handoff 08 names for both themes.
- **Home-bar-only controls**: the instrument switch, the Ableton Link toggle and the import button. All three are decisions made *before* a run — what to play, what is plugged in, what is in the library — and the trainer bar is the one that is tight for width. Link stays joined once you start; there is simply no toggle mid-run.
- **Bar tooltips are `data-tip`, never `title`.** WKWebView's native tooltip is not dependable in the titlebar — late, often absent, sometimes a flash — so `BarTooltip.vue` draws them from one delegated listener. A control opts in by carrying the attribute. **Do not leave `title` on the same element**: the platform would draw its own on top, which is the thing being replaced. `data-tip` is a tooltip and not a name, so a glyph-only button still needs its own `aria-label`. Dialogs and the monitor keep plain `title` — they are ordinary page content and behave normally.
- Don't add code for a future milestone "while you're there". If something is unused today, it doesn't belong in the tree.

## Where things stand

**M0–M7 are complete — the plan's whole roadmap.** M6 (Ableton Link) shipped: `src-tauri/src/link.rs` behind the
`link` cargo feature, `useLink.ts`, a chain-icon toggle with a peers badge, and a
follower in `useTrainer` that drives tempo via `Transport.setBpm` and phase via
`Transport.anchorTo`. `docs/ableton-playalong.md` documents it, including the
MIDI-Clock alternative if CMake ever becomes a problem.

**Link alignment is session phase, and only session phase.** Phase comes from
the session's own beat grid, so following it can never put the loop off the
beat. The peer's *transport start* is the tempting alternative — with start/stop
sync it is the one thing Link says about where their loop begins — but
`time_for_is_playing` is the time of an event, not of a beat, so a transport
started off the grid drags our whole loop off it. That was built (Rust reporting
`playing`/`beatsSinceStart`, a follower counting from their downbeat) and
**reverted**: it bought the right bar at the cost of the right beat, which is
the worse trade. Don't rebuild it.

**Start always starts.** A version that armed and waited for the peer's next
transport start also shipped and was reverted — a loop already running never
produces one, so the app sat in the count-in for ever.

What survives from that round is the one thing that was measured rather than
inferred: **`Transport.start` takes a `StartGrid`** so beat 0 is pinned to Link's
grid instead of being yanked onto it a frame later. That yank was up to half a
loop and it ate the count-in it landed in — measured at 1.427s to 2.317s against
a 2.15s bar — and `anchorTo` moved the scheduling window with it, so the skipped
clicks never sounded. `tests/link-sync.test.ts` simulates a session and pins it.

**Build the `AblLink` on join, never at startup, and drop it on leave.** When
two Link sessions meet the longer-running one wins the merge and its timeline —
tempo included — is adopted by everyone else, and Link measures that from the
instance's *construction* (`initXForm` maps construction to ghost time 0;
`Sessions.hpp` prefers the larger ghost time). Held open from app launch, ours
was older than the one inside a DAW opened later, so we won and shoved our seed
tempo of 120 onto the user's running set the moment they enabled the toggle.
`LinkHandle.link` is a `Mutex<Option<AblLink>>` for exactly this reason — don't
"simplify" it back to an eager field.

**Link's quantum is one bar (`linkQuantum`), not the lesson's loop.** Link
carries no loop length, so which bar of a 4-bar Ableton set a 2-bar lesson
starts on is not knowable — but with a one-bar quantum it becomes the player's
to choose, because `gridAtOrAfter` steps by the bar: the count-in occupies the
bar after the press and the run starts the bar after that, so pressing two bars
before the wanted downbeat lands on it. Stepping by the loop instead (the
original) made every candidate start a whole loop apart and therefore all of one
parity, so the other bars of a longer set were unreachable however the press was
timed. Don't put the quantum back to `loopBeats`, and don't add a bars-per-cycle
setting without asking — that was offered and declined in favour of this.

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

### M7 — polish & package (done)

**Timing calibration.** `src/engine/calibration.ts` is the pure half: `tapError`
places a strike against the nearest click on a fixed grid, `summarizeTaps`
reduces a set to a median and a median absolute deviation. Median throughout —
two ragged taps out of sixteen are certain on a first run and must move the
answer by nothing. The spread is reported so a loose set is *called* loose
rather than quietly applied. `useCalibration` runs the click on a plain
interval queued onto the audio clock: no transport, no scorer, so the only
thing measured is the gap between click and strike. **Taps are fed
`rawHitTime`, not `hardwareHitTime`** — applying the offset under test would
report only its residual. `settings.latencyMs` is then subtracted from every
*hardware* strike; a mouse click or a computer key carries no offset, having no
rig to cancel.

**Persistence.** Settings, last lesson and per-lesson history already persisted;
M7 added `latencyMs` and, the real gap, **imported clips**. They used to live
for the session, which left `history` holding runs for a lesson that no longer
existed. `src/engine/library.ts` validates what comes back out of the store —
a lesson with no notes does not fail at the store, it fails three screens later
inside the scorer. Invariant 7 still holds: no `localStorage`.

The plan's "streaks, a session log" were **not** built. `AdvanceTracker` resets
every `play()` and clears at a streak of one, so persisting it would persist a
number that is always zero; a session log nothing reads is dead weight. Say so
rather than building either — and if a streak is wanted, it needs a reason to
exist first.

**Focus and motion.** `styles.css` now carries one global `:focus-visible` rule,
because per-component rings meant the dialogs' buttons had none. `useFocusTrap`
keeps Tab inside a modal — `aria-modal` marks the page behind inert for a
screen reader and does *nothing* to the Tab key. Both dialogs take focus on open
and hand it back on close. Reduced motion is one global `* { animation: none
!important; transition: none !important; }`; don't repeat it per component.

**Packaging.** `docs/packaging.md` is the reference. Signing credentials come
from environment/secrets only, never a checked-in file, and the release workflow
completes without them by producing unsigned artefacts. `src-tauri/Info.plist`
is merged automatically by tauri-bundler and carries
`NSLocalNetworkUsageDescription` — from macOS 15, Link without it is denied the
LAN silently, which looks exactly like Link being broken.

The app is **Melodable** everywhere now — `productName`, the window title, the
page title, the npm package, and the MIDI client name other apps see in their
port lists. The bundle identifier is `io.github.gabrielom.melodable`, changed
once from the `com.local.rhythmtrainer` placeholder while the only data at risk
was the author's. **Don't change it again without a migration**: it decides
where the Tauri store lives, so a new one reads as a fresh install — settings,
calibration, history and imported clips all gone. `build_plan.html` still says
"Rhythm Trainer" and is left alone, being the original spec rather than a live
document.

**The calibration dialog is not in any design handoff.** It is built in the
dialogs' existing language rather than inventing one, and wants drawing.

- Don't reintroduce automatic tempo changes; tempo stays hand-set on the bar.

### The intermittent input delay: closed

There was an M8 here, parked as a troubleshooting milestone: *"there is once
again a delay when I am playing the notes, sometimes it happens. sometimes
not."* The user reports it has stopped happening, and asked for it to be
dropped. **Don't reopen it speculatively, and don't "fix" it in passing.**

Two findings from that round are still worth keeping, because they are
measurements rather than guesses:

- **The render loop is not a plausible cause.** Measured with a worker posting
  messages into the running app at an irregular cadence — the same shape of
  arrival a MIDI event has. It waits 2-4ms at p99 to be picked up, in all four
  views, and no frame exceeded 32ms.
- An earlier round was "fixed" by cutting per-frame canvas cost and the delay
  went. Given the measurement above, that is **unexplained, not a precedent.**

If it ever returns: start with data, not with a fix. A whole commit of
plausible-sounding changes was written and reverted for exactly that reason.
Log every incoming message's kind and its arrival gap (`audio.now` minus the
midir timestamp mapped through `HostClock`) while it is happening, and ask
first whether it is the *sound* arriving late or the flash and the grade — the
two have different causes. `midir`'s `Ignore::All` filters only sysex, clock and
active sensing, so continuous aftertouch shares the queue with note-ons; if that
turns out to matter, thin the stream — **do not drop those messages, the user
wants aftertouch.**
