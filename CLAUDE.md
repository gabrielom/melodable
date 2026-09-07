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
- **Colour on the staff is three states, and they take the two systems away
  one at a time** (handoff 12, middle state reversed). `settings.colourMode` is
  `all | results | mono` and sets `LaneFrame.colourMode`; `noteInk` is still
  the single place that decides. `all` is the trainer's normal behaviour, both
  systems on. `results` drops the **hues** and keeps the **judgement**: plain
  `palette.txt` ahead of the playhead, timing colours behind it — what is
  coming reads as notation and nothing else, and how it went still reads at a
  glance, which is the state to sight-read in. `mono` drops both.
  **Scoring is untouched in every state**: the score row, the summary and the
  run history do not know this setting exists. `tests/note-ink.test.ts` pins
  all three in both themes, including that an unplayed note in `results`
  carries *no* lane tint in any strength.
  **The middle state is deliberately the opposite of what §1 describes.** The
  handoff calls it "targets only" — hues kept, judgement dropped — and it was
  built that way; the user has now said three times that what they want
  silenced on a staff is the pitch tint, not the mark. Their sentence is the
  spec: *"all the notes to the right of the playhead should have no colour,
  after the playhead they should all have timing colours."* Don't "restore"
  the handoff's reading without asking. `all` was checked at the same time and
  is **unchanged** — dimmed hues ahead, timing colours behind.
  Old keys migrate: `sheetInk: colour` → `all`, `sheetInk: mono` → `mono`, and
  `colourMode: targets` → `results` (same slot on the toggle).
- **The colour toggle's icon is a sample, not an abstraction** (§2). Three
  cells on the arrow pair's geometry, each holding three 2.5×9px bars drawn
  from the palette that state keeps: timing colours for `all`, the off grey
  for `mono`, and for `results` **one timing colour then two greys** — read
  the bars as three notes in time and the playhead sits a third along
  (`PLAYHEAD_FRAC`), so one bar in three is literally the coloured part of the
  staff. The handoff's own middle icon (two hues and a grey) went with the
  middle state's old reading, and `--swatch-blue`/`--swatch-violet` went with
  it: that state has no hue left to sample. Selected takes the segment's
  normal fill **plus a 1.5px ring in `--led1`**, the home screen's
  selected-card accent, and the first use of that accent inside a trainer
  control. **Not a solid accent fill** — drawn that way first, the amber
  background swallowed the amber bar inside the `all` icon (§3). The bar
  colours live in `styles.css` beside `--led*` rather than in `theme.ts`:
  they are chrome that samples the palettes, and the grey is a different text
  token in each theme.
- **The falling views never leave `all`** — strip a lane stack of its hues and
  nothing is left to tell one lane from another — which is why the toggle is
  sheet-only.
- **A lesson is a finite run, not an endless loop.** The pattern plays
  `lesson.repeats` times (built-ins are 16 bars, 39-55s) and then ends; the run
  is scored as a whole, and clearing one clean run advances the library.
  `lessonRepeats` derives a count for imported clips that don't state one.
  The overview strip spans the whole run, which is what makes its viewport
  rectangle a meaningful slice rather than the entire width.
- Lane identity is a **hue from the fourteen** (`hueOf`), indexed by the lane's position on screen — not by pad number or pitch, so a lane keeps its colour between lessons. Pads walk the list in order; piano starts on the cool end (blue, violet, bronze, teal) so a chord reads as separate voices. The **dimmed** value is derived, never authored: `mix(hue, field, 0.60)` in dark against `#0d0d0e`, `0.35` in light against `#cccccc`. That reproduces the design's own dimmed column for all fourteen in both themes, and `tests/theme.test.ts` pins it. A lane's strip, its lit mini-grid cell and its unplayed notes are all that same dim tint; full strength means the lane is sounding *now*. This supersedes the old 8-colour LED set, three of which doubled as rating colours.
- `--led0..2` in `styles.css` are **not** lane identity — they are chrome accents (the device dot, the resume flag, the monitor's source dots) and are deliberately not mirrored in `theme.ts`.
- Respect `prefers-reduced-motion`; keep controls keyboard-focusable.
- **A strike that hits nothing is a wrong note, and it is charged.** One rule
  covers both cases: a lane the lesson never asks for has no targets at all,
  and a lane it does ask for struck far from any of them has none near enough.
  `Scorer.hit` returns `hit | wrong | ignored`. A wrong note adds to the
  accuracy denominator with no points and breaks the combo, and is counted
  **outside `tally`** for the same reason holds are — the tally answers how the
  *lesson's* notes went, and this was not one of them. **`WRONG_GRACE` is what
  stops one mistake being billed twice:** a note struck 150ms late grades as
  nothing and its target is swept as a miss a moment later, so calling the
  strike wrong as well would take two zeros for one error. Inside the grace the
  strike is `ignored` and costs nothing — **but it still draws its dot.** The
  grace is a scoring rule, not a reason to hide the strike: the eye wants to
  know *where* it landed, and for an attempt that is the gap between the dot
  and the notehead beside it — the timing error, drawn. The check looks at targets *regardless of
  `resolved`*, because by the time a late strike lands its target has usually
  been swept already — that is the case the grace exists for. A consequence
  worth knowing: in a lane whose notes are closer together than twice the
  grace, no strike can ever be wrong, which is right — "completely out of time"
  has to mean completely.
- **The wrong-note mark is a small dot, and it scrolls with the music.** Not a
  flash at the playhead: that would be gone before you could look at it and
  would say only *that* something was wrong, never *where*. Left in the
  timeline where it was struck, the played-out half of the lane becomes a
  record — three dots crowding one beat says you are rushing that beat — and it
  scrolls away like everything else, pruned off the renderer's own `behind`
  window. **A mark belongs to a run**, so the frame gates them on the same
  `pos` that chooses between live instances and the parked preview. Clearing
  them in each stop path instead is what shipped first, and `stop()` was
  missed: the dots stayed on the idle lane and went on scrolling, because
  `now` advances whether the transport does or not. Both it and a missed note are red, because both are results and the
  rating language has one red; **size is what separates them**, and `paintWrong`
  rings the dot in the bed colour so it still reads sitting on a missed note of
  the same red. All five draw paths have it (pads and piano in both
  orientations, sheet). A lane the view cannot show — an unused pad, a pitch
  outside the roll's range — gets **no mark and still scores**; drawing it at a
  clamped edge would name a note the player did not play. Sheet is never in
  that position, notation having a place for every pitch.
- **A note can have a length.** `NoteEvent.duration` is in beats; anything under `HOLD_MIN_BEATS` is an ornament and normalised to zero by `lessonTargets`. A held note is judged twice and independently: the onset rating is unchanged and alone decides the colour, and the sustain is measured from the note's *written* onset so a late strike is not charged twice. Overholding is not an error — the fraction clamps at 1, and a hold still open at the written end closes itself, which is also what stops a controller that never sends note-off from scoring every hold as dropped. Combo breaks on a dropped hold, survives a short one. Pads carry no duration on import (a drum has decayed before you could let go), though the renderers support pad holds if a lesson authors them.
- **Everything lives in the one transport bar**, which is also the macOS titlebar (left padding clears the traffic lights). It is 34px tall with every control 20px, and stays a single row with nothing hidden. No second toolbar row, no in-stage header.
- **The window floor is what keeps the bar intact**: `minWidth` in `tauri.conf.json` is **1216**, measured as the narrowest width where every trainer control fits at natural size. The binding case is **piano in sheet** (1214px) — `KEY`, `NOTE | DEGREE`, the colour toggle and `ROLL | SHEET` at once; piano in roll needs 1192 and pads only 941, so the longest *pads* title stopped being the constraint at handoff 11. **A plain browser understates the floor** — the device chip reads "NO DEVICE" at 91px rather than its 116px cap, so force the widest label when measuring (`scratchpad/floor11.mjs` does). The bar's 84px left inset is part of the budget too; the frames use 72, and the extra 12 is ours (72 left the ✕ almost touching the zoom button). Below the floor **nothing is pushed out** — handoff 11 §3.2's shrink order takes over: the spacers collapse, then the device name truncates (min 46px, keeping the LED and the caret), then the lesson title (min 36px). It rose 16px when the `KEY` chip got the design's own `gap: 5px` / `0 7px` back (67.7 → 83.7px); that spacing is the chip, so the width is paid rather than shaved. Handoff 12 §4 names the next lever if it is ever needed: compress the colour cells from 20px to 14px (−18px) before truncating anything. The bar's own symptom is silent, so the check is `bar.scrollWidth <= bar.clientWidth`; jsdom has no layout, so that is a browser measurement and not a unit test.
- The bar carries **`data-tauri-drag-region="deep"`**, not the bare attribute. Tauri's shim walks up from the clicked node and stops at the first interactive element, so controls opt out of dragging by themselves; the bare form only catches direct hits on the header, which at this density is gaps and nothing else. Anything non-interactive that hangs off the bar — the dropdowns — needs `="false"` so a click on its own chrome doesn't drag the window. `-webkit-app-region` is Electron-only and does nothing here.
- Dragging also needs **`core:window:allow-start-dragging`** in `src-tauri/capabilities/default.json`. `core:default` does *not* include it, and the shim swallows the rejection, so the failure is silent and looks like a CSS problem: the window still moves on the click that focuses it (AppKit handles that one) and double-click-zoom still works (`internal-toggle-maximize` *is* in the default set). Don't drop that grant.
- Keep `-webkit-user-select: none` alongside the unprefixed rule. WKWebView only honours the plain property from Safari 17, and a live text selection beats the drag on the same mousedown.
- **The name macOS shows in dev is the binary's filename, not `productName`.**
  `tauri dev` runs the cargo output directly — there is no `.app` — so the Dock
  hover and cmd-tab read the executable, which was `rhythm-trainer` long after
  everything else had been renamed. Fixed with a `[[bin]] name = "Melodable"`
  target in `src-tauri/Cargo.toml`, which is what Tauri's own docs point at;
  `mainBinaryName` is applied at bundle time and so never reaches dev. The
  crate stays lowercase `melodable`. A *bundled* build takes its name from
  `productName` and was always right — if a built app still shows the old one,
  that is the LaunchServices cache, not the bundle.
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
- **The chart's numbers are on hover, not stamped on it.** Every dot has a
  transparent 12px target — a 3px circle is not a pointer target — and hovering
  one names its score below the dot. The **BEST flag is hover-only too**, over
  the highest attempt wherever it sits (earliest on a tie), which is not always
  the latest run. It used to sit permanently over the current dot; the header's
  `NEW BEST` already says that, so the flag was saying it twice. Tip below the
  dot and flag above, deliberately: they collided when both wanted the space
  above, and scores cluster near the top of the plot so below is the empty
  half.
- **Both chips are the same box, and neither wears the flag's colour.** Same
  height, corner and type; `badgeAt` and `tipAt` place them. But green is
  `--rate-perfect`, a *rating*, so a 62% run wearing it would read as a
  judgement of that run — the score chip takes `--bar` with the standard
  hairline instead. They stand `gap` off the dot rather than tucked against
  it, because the **mouse cursor hangs down and to the right of what it is
  over** and a chip any closer sits under the arrow pointing at it; that
  clearance is ~21 viewBox units, measured against a 19px arrow and the
  chart's ~0.93 units-to-the-pixel scale, and `tests/run-history.test.ts`
  pins it. Under about 22% there is no room below, so the chip **flips
  above** and the flag stacks above *it* — clamping to the floor instead
  would lay the chip across the dot it names. The viewBox is 10 taller than
  handoff 10 §2 drew it, with the plot 10 lower inside it, purely as headroom
  for the enlarged flag over a full-marks run; `PLOT_SPAN` is untouched.
- **Sheet is a third trainer mode, not a third instrument** (handoff 10 §1).
  `ROLL | SHEET` swaps the renderer under the same transport and scorer —
  invariant 4 still holds, and `SheetStaff` is a renderer plus a pitch→staff
  mapping like the other two. It is **horizontal only** (notation has no
  vertical form, so the `↓` control is disabled, not hidden) and **piano
  only**: a treble staff read by pitch with a keyboard under it says nothing
  about a drum pad, and no percussion staff was ever drawn. Six of the seven
  built-ins are pads, so for most of the library the pair is simply absent —
  `sheetAvailable` is the gate.
- **The key signature is derived from the lesson, not authored on it.** An
  imported clip carries no key, and asking the player to name one before they
  can read the staff is a worse trade than reading it off the notes.
  `keySignatureFor` costs every signature by the only measure that shows on the
  page — how many *notes* fall outside its scale — and takes the cheapest, with
  a tie going to the simpler signature. So a bare triad, which is diatonic to
  three keys, is written in the plainest of them rather than an arbitrary one,
  and **a lesson that uses only part of a scale will honestly get a smaller
  signature**; that is the rule working, not a bug. Major and relative minor
  share a signature, so there is no mode to guess. `spell` then places and
  inks each note against it: bare in the key, a natural where the signature
  would alter it, a sharp or flat outside it — which is what makes flat keys
  spell as flats instead of the sharp equivalents the key-less pair gave them.
  `spell(p, 0)` reproduces `staffStep`/`accidentalFor` exactly, and
  `tests/notation.test.ts` pins that plus a full round trip over every key and
  every pitch.
- **The `KEY` chip is the design's read-out with a way into the list added.**
  Handoff 11 §1.5 draws a plain `.field`: `gap: 5px`, `0 7px` padding, `KEY` in
  `--txt3` beside the key in `--txt`, 68.4px wide — measured off the frame. Ours
  is that plus a caret, because the design's chip only reports the key and ours
  also picks it. **Those two spacing numbers are the whole look**: for one
  commit the chip was a split control (label switches degrees, caret opens the
  list) and carried `gap: 0; padding: 2px` to suit; `NOTE | DEGREE` came back
  and took the switch job with it, the markup reverted, and the CSS did not —
  which is how it came to read `KEYC maj` inside a 2px inset. One button now,
  so the whole chip inverts when the menu is open. `DEG` in the pair is spelled
  `DEGREE` in full (handoff 12 §5).
- **Degree mode is a relabelling and nothing else** (handoff 11 §1). The chip
  swaps what a note is *called* — colour, geometry, the grid and every
  timing rule are the same run either way. Piano only, like the key chip and
  sheet: a degree is a statement about a scale and a drum pad is not in one.
  `degreeOf` reads the letter out of `spell`, so the two labellings can never
  disagree about which note they are naming. Its alteration is **not** the
  notation accidental: it is measured against the scale's own version of that
  degree, so an F♮ in E major is written with a natural sign and called `♭2`.
  Roll puts the digit inside the notehead where the letter was, and a degree on
  every white key of the rotated gutter with the note name pushed to the edge
  facing the roll — the name stays because it is still the key you press.
  Sheet has nowhere to put a label inside 17px of solid ink, so the digits go
  on their own row under the staff.
- **The key chip is derived by default and overridable.** `keySignatureFor`
  already reads a key off the notes; `settings.keyOverride` is the escape
  hatch, because a clip that uses only part of a scale honestly derives a
  smaller signature and only the player knows what it is really in. Majors
  only in the list: a signature names a major and its relative minor equally,
  and handoff 11 leaves which one a lesson is in open (its question 2).
- **A degree digit's ink is derived, never picked** (§1.3). A dimmed
  instrument tint on staff paper fails contrast outright — 2.27:1 light,
  1.61:1 dark — so `readableInk` walks the hue toward black on light paper or
  white on dark and stops at the first step clearing 4.5:1. Smallest shift
  that works, so the hue stays recognisable.
- **Everything under a notehead is anchored on `NOTEHEAD_EM_DX`, never on ink
  bounds** (§1.2). An eighth note's flag reaches right, so an ink-centred label
  lands pixels off a note whose head is exactly where a quarter's is. The whole
  note's `0.257em` is measured off the font and matches the handoff exactly;
  the stemmed `0.2006em` is the handoff's, corroborated against the half note.
  `SheetStaff.headHalfWidth` was a single fudged `0.13em` before this, which
  put every glyph-drawn note about 5px right of the bare heads a chord or a
  beamed group draws — the two paths disagreed about the same beat.
- **The chord ribbon is derived, and it is a map rather than a score.**
  `chordsForLoop` costs every diatonic triad by how much of a bar it accounts
  for — a note on a chord tone counts for it, one off it counts against — and
  a tie goes to the triad whose **root the bar leans on hardest**, then to the
  one rooted on the bar's lowest note, which is what a bass line is for, and
  only then to the lower degree. Root weight comes first because a melody has
  no bass line, so "lowest note" says nothing there: B D♯ F♯ G♯ keeps three of
  its four notes under both `V` and `iii`, and only the weight on B tells them
  apart. Notes are weighted by **length × metrical position**, not
  counted: an imported clip is usually a melody with no chord track, and a
  melody states its harmony in its long notes and on its strong beats while
  filling the gaps with passing tones that belong to no chord at all. Counting
  every note equally lets a run of semiquavers outvote the crotchet the bar is
  built on. It reads from `lesson.notes` rather than `targets` for the same
  reason — `lessonTargets` zeroes any length under the hold floor, which would
  flatten the weighting it depends on. **Extra tones are additions to a chord
  already named**, never candidates of their own, and each earns its label only
  at a fifth of the bar's weight (`EXTRA_SHARE`); below that it is a passing
  note, and calling every triad a seventh would say less than calling none of
  them one. The seventh is one such addition; the **added second, fourth and
  sixth** (`ADDED_STEPS`) are the others, which is how Hooktheory's own reading
  of No One's second bar — `V(add6)`, printed `B6` — comes out of the melody
  alone. **At most one added tone**, the one the bar leans on hardest: a bar
  brushes several non-chord tones in passing and naming them all would say less
  than naming none. A sixth is written into the absolute name as a **figure**
  (`B6`) because that is how the symbol has always been spelled; the second and
  fourth have no such shorthand and keep the word. Same trade as
  `keySignatureFor`, and it fails the same honest
  way: an ambiguous bar is named confidently and may be named wrong. Shown only
  with degrees on, because the ribbon is the harmonic half of that reading;
  empty means **hide the strip**, never draw empty blocks (§1.5). It **never
  takes a timing colour** — history is a 3px top rule and the current bar a 2px
  inner border, both in the playhead's colour, because an earlier design draft
  dimmed past chords and they read as disabled. §1.4 names four of the seven
  function hues (I blue, IV teal, V bronze, vi violet); ii, iii and vii° are
  ours, taken from the same palette. It is drawn on the lane's own canvas from
  the lane's own `xOfBeat`, so the blocks and the bar lines above them cannot
  drift — which is what lets the playhead run straight through it. The roll has
  no label column inside its canvas (the keyboard owns that column, outside
  it), so `CHORD` appears only in sheet, whose clef gutter is on-canvas.
- **Notation comes from Noto Music, vendored in `src/assets/fonts`** — never
  drawn by hand and never fetched from a CDN. Two numbers are measured off the
  font binary rather than estimated, and `tests/notation.test.ts` pins both: a
  notehead is `0.252em` tall (so `fontSize = staffSpace / 0.252`) and its
  centre sits `0.134em` above the alphabetic baseline. Replace the font and
  re-measure; do not assume they carry over. The accidentals add a third set,
  measured the same way but from each glyph's **counter** — the hole it
  encloses, which is the part an engraver lines up with the note. The sharp's
  and the natural's land on the notehead centre to three decimals, which is the
  font saying they are drawn to sit level with a head; the flat's is `0.1175em`
  and does not, because its bowl hangs below a stem that rises out of the way.
  The clef's ink runs to `0.661em`, which is what `SIG_X0` clears so the key
  signature does not sit on top of it. **Canvas cannot wait for a
  webfont** — `ctx.font` falls back silently and the frame is already painted
  — so `useNotationFont` loads it and the sheet renderer is not built until it
  is in.
- **Beamed groups are assembled; a lone note is one glyph.** Handoff 10 §1.4
  and handoff 12's own notation set both say it: *"Beamed groups have no glyph
  at all and must be assembled"* — bare heads, a 1.8px stem each, a 4.2px beam
  per subdivision stacked at 6.4px, and a half-length stub for a broken group.
  **The catalogued notation set is the reference for every figure**, decided
  with the user, and it outranks the trainer staff drawn beside it: that staff
  happens to hold no group short enough to need a beam, so its all-glyph
  content is an accident of the music in it and says nothing about the rule.
  Beaming was deleted once on exactly that misreading and the notation stopped
  being correct — don't repeat it. A **chord** shares one stem too, because
  stacking a glyph per notehead stacks a stem per head and reads as a smear.
- **A bare head is the glyph's head, measured, and one function places the
  stem** — `NOTEHEAD_EM_HALF_WIDTH` (`0.1464em`, rasterised at the drawn size)
  for the head's radius *and* for where the stem attaches, `SPACE / 2` for its
  height. They were fudged multiples of the staff space before, 3% wide and 5%
  short of the glyph beside them. **`stemX` is that one function and both
  callers go through it**: two copies of the offset is the actual bug here —
  `beamGroup` kept its own `headHalfWidth(size) * 0.92`, which tracked the
  *glyph seating* rather than the head, and when that seating became per-figure
  every beamed stem stood 2.3px clear of the head it belonged to. That is what
  "the stem doesn't connect" was, and it is a two-copies bug, never a reason to
  stop beaming.
- **What the font does not give you** (§1.4): the augmentation dot is a
  combining mark with no advance width, so it is drawn; and every stemmed glyph
  is stem-**up**, which the frames accept.
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
