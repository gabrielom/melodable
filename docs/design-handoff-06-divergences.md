# Handoff 06 — where the app and handoff 05 disagree (app → design)

This one goes app → design. Handoff 05 is **built**: sustained notes end to end,
the fourteen instrument hues with the target/result split, the 33px overview
strip, and the instrument switch moved to the home bar. Everything in 05 holds
except the four things below.

Three of these are places the implementation **knowingly departed** from 05,
each because following it literally produced something worse or impossible.
Each needs a decision from you so the drawings and the app say the same thing.
The fourth is two corrections to `11a`, already decided. The last two are
things the app has that no frame has ever shown: the Ableton Link toggle, and
the bar's tooltips.

Every number here is a computed value read out of the running app or measured
off your own frames, not an intention. Where a frame was measured it says so.

---

## 1. The 34px minimum bar cannot survive the falling views

**§1.5:** *"A hold with under `34px` of visible bar is drawn as a plain head
with no bar."*

That figure works on the **scrolling** axis and fails on the **falling** one,
because the two axes have very different amounts of room for the same five
bars of music.

### What the app actually has

Measured at the default 1280×780 window. The zoom is `track ÷ (5 bars × 4
beats)`, so one beat gets a twentieth of whichever axis carries time:

| view | time axis | px per beat | 34px is |
|---|---|---|---|
| pads horizontal | 1140px (width, less the 128px label gutter) | 57.0 | **0.60 beats** |
| piano horizontal | 1208px (full width) | 60.4 | **0.56 beats** |
| pads vertical | 655px (height, less the 42px label tile) | 32.8 | **1.04 beats** |
| piano vertical | 543px (height) | 27.1 | **1.25 beats** |

So in the horizontal views 34px is a bit over half a beat — a sensible floor
that only drops ornaments. In the vertical views it is a whole beat or more:
**a quarter note would never draw a bar, and in piano vertical neither would
anything under a dotted quarter.**

It gets worse as the window shortens, because the vertical axis is the window's
height. At a 560px-tall window piano vertical falls to ~16px per beat, where
34px is over two beats and *nothing in First Chords draws a bar at all*. That
is not a corner case; it is a laptop with a browser open behind the app.

### Why this reads as a conflict rather than a rule we dislike

`11c` and `11f` both plainly draw holds. Measured off those frames, your bars
are **47.8px** (`11f`, piano vertical) and **52.8px** (`11c`, pads vertical) —
comfortably over your own 34px floor. They can be, because the frames are 500px
tall and the app's window is 780: your roll has far fewer beats on screen than
ours does. The rule and the drawings are consistent *with each other* and
inconsistent *with the app's zoom*.

### What the app does now

The floor is per-axis. Scrolling keeps your 34px. Falling uses a structural
minimum instead — the two caps plus enough slot between them to read as a
channel rather than a seam:

```
falling floor = headCap + tailCap(5) + slotMin(10)
              = 27px in piano vertical, 15px in pads vertical
```

At the default window that makes a quarter note the shortest drawable hold in
piano vertical and an eighth in pads vertical, which is about where a hold
stops being a hold.

**`slotMin` is the one number in the sustain work that is ours, not yours.**

### What we need from you

Either:

- **(a)** confirm a per-axis minimum and give us your figure for the falling
  one — this is the smaller change and keeps everything else as drawn; or
- **(b)** tell us the falling views should show **fewer bars** than five. That
  is what your frames imply, and it would make one 34px rule true everywhere.
  It is a much bigger change: the five-bar zoom is shared by both orientations
  and both instruments, and the overview strip's viewport rectangle is derived
  from it.

We have built (a). If you want (b), say so and we will change the zoom rather
than the floor.

---

## 2. §1.5 and §1.4 contradict each other on bars crossing the playhead

**§1.4:** *"The bar therefore **legitimately crosses the playhead** while a
note is being held. `11c`, `11e` and `11f` all show this. Do not 'fix' it."*

**§1.5:** *"Pads horizontal only: the note sitting **on** the playhead is drawn
plain, without a bar."*

These cannot both hold. §1.5 would make a bar disappear for the few frames
either side of its head crossing the line and then reappear — a flicker on
every held note, every repeat, in one view only.

**The app follows §1.4.** Bars cross the playhead in all four views.

We think §1.5's line describes what `11b` happens to show — the note under the
playhead there is a closed hat, which is an instant note — rather than a rule.
**Confirm and we will delete the line from our notes; tell us it is a real rule
and we will need to know what should happen as the head crosses.**

---

## 3. The piano pitch → hue order: the prose and the two frames all disagree

**§2.2's table** assigns `BLUE = piano 1st`, `VIOLET = piano 2nd`,
`BRONZE = piano 3rd`, `TEAL = piano 4th`, and **§4.1** says *"Each pitch gets
its own hue from §2.2, low → high."*

The frames do not do that, and they do not agree with each other. Measured
upcoming (dimmed) fills, by row:

| frame | pitches, low → high | hue given |
|---|---|---|
| `11e` piano horizontal | C4, C#4, E4, G4, G#4, C5 | BLUE, —, VIOLET, **STEEL**, PLUM, **INDIGO** |
| `11f` piano vertical | C4, C#4, G4, G#4, C5 | BLUE, —, **VIOLET**, —, **STEEL** |

Both agree the first pitch is BLUE. After that `11e` makes G4 steel and C5
indigo; `11f` makes G4 violet and C5 steel. The same pitch gets a different
hue in the two frames, so neither can be the source.

**The app follows the prose**: rank 1→BLUE, 2→VIOLET, 3→BRONZE, 4→TEAL, then
the list continues PLUM, INDIGO, OLIVE, STONE, then the six spares.

**Please confirm the prose is right and redraw `11e`/`11f` to match**, or give
us the intended order explicitly. This is the one divergence where we are
fairly confident the frames are simply hand-coloured, but it is also the one a
player would notice first — it is every note in the roll.

While you are in there: the dimmed values in §2.2's table are all reproducible
as `mix(hue, field, 0.60)` in dark and `mix(hue, field, 0.35)` in light, for
all fourteen hues — but only with a **dark field of `#0d0d0e`**. §2.2 names
`#141415` for pads, which does not reproduce your own column. We derive with
`#0d0d0e` in both instruments; the difference is 4/255 and invisible, but the
table is the thing that is right, not the field note.

---

## 4. Two corrections to `11a` (decided — no question here)

### 4.1 Drop the `1 × 8` pad layout

`11a` draws the pad-layout panel with three rows: `4 × 4`, `2 × 8` and
`1 × 8 — top row only`. The app has **two** layouts and is not adding a third.
Please remove the `1 × 8` row; the panel becomes two rows and loses 26px of
height.

### 4.2 Add the volume and monitor buttons

`11a`'s right group is missing two controls the app has on every screen. Both
already exist in your trainer frames (`11b`…`11f`) — this is the same pair,
in the same place.

The app's home bar, in full, at a 1180px window to match your frame:

| control | x | width | note |
|---|---|---|---|
| `7 LESSONS` | 721 | 51 | |
| divider | 780 | 1 | 9px either side |
| `PADS ▾ \| PIANO` | 790 | 99 | as drawn |
| **Ableton Link** | **898** | **20** | **missing — see §5** |
| device chip | 927 | 91–116 | 116 is its cap, with a device name showing |
| **volume** | **1027** | **20** | **missing from `11a`** — the mixer popover |
| import `⇪` | 1056 | 20 | |
| divider | 1085 | 1 | |
| theme `◐ ☀` | 1095 | 46 | |
| **monitor `▤`** | **1150** | **20** | **missing from `11a`** |

Volume sits **between the device chip and `⇪`**; monitor sits **after the theme
pair**, at the far right. Both are 20px square with the standard 9px gap.

---

## 5. The Ableton Link toggle has never been drawn — in any frame

This one is not a divergence, it is an omission on both sides: the control has
existed since M6 and no handoff has ever drawn it. It is in **every** frame's
bar, trainer and home alike.

| | |
|---|---|
| **what** | a toggle that joins the Ableton Link session — tempo and downbeat follow Ableton |
| **size** | 20 × 20, same as `⇪` `▤` and the other icon buttons |
| **where** | immediately **after the divider that follows the scores** (trainer) or **the lesson count** (home), and immediately **before the device chip**. Same slot in both bars — x=806 in the trainer at 1180px, x=898 on home. |
| **glyph** | a chain link, drawn as a 10 × 10 SVG on a 16 × 16 viewBox: a short diagonal stroke with a hooked stroke either side of it, 1.5px, round caps |
| **off** | the ordinary icon-button treatment — `--face` fill, `--txt2` glyph |
| **on** | `--head` (the playhead cyan, `#4ccfe0` / `#2c2d2e`) rather than the usual inverted chip, because Link being live is a *connection* state and reads with the playhead, not with the on-states |
| **badge** | a peer count at the top-right corner, offset −4/−4: min-width 11px, 6px radius, `--head` fill, `--win` text, 7.5px/500, 11px line-height. Shown only while on. "1" is the usual value (Ableton counts as one peer). |

It sits with the external-gear controls — device, SYNTH/DAW — because that is
what it is, and that grouping is why it goes before the device chip rather than
next to the transport.

**Please draw it in the turn-12 frames.** If you would rather it were somewhere
else, or looked like something else, now is the moment — it has had no design
attention at all, and what is there now is a developer's guess.

### Why this cost us a number

The toggle only renders when the Tauri build has the `link` cargo feature, so
in a browser it is absent. The window floor quoted in the appendix was measured
in a browser and was **29px short** (20px control + 9px gap). Corrected: the
trainer bar needs **1100px** and `minWidth` is now **1111**, not 1082. Same
class of mistake as the device chip reading "NO DEVICE" at 91px instead of its
116px cap — both are now forced when measuring.

---

## 6. Tooltips are ours now, and they have never been drawn either

The bar's controls are mostly 20px glyphs, and a tooltip is the only thing that
says what one does. We had been using the platform's own (`title`), and in
WKWebView it is not dependable: it arrives late, often not at all, and
sometimes flashes and disappears. The markup was not at fault — every control
carries its text and nothing overlaps them.

So the bar no longer uses `title`. It uses `data-tip`, and we draw the tip.
What is there now, built from existing tokens:

| | |
|---|---|
| **surface** | `--gutter` fill, `--hair` hairline inset, `0 6px 16px #00000055` drop |
| **type** | `--sans` 11px, `--txt`, 1.35 line-height |
| **box** | 4px / 7px padding, `--r-field` radius, `max-width: 260px`, wraps and balances |
| **position** | centred under the control, 6px below it, clamped 8px from the window edges; flips above if it would fall off the bottom |
| **timing** | 450ms before the first one appears; then the bar stays "warm" for 400ms, so sliding along it names each control instantly instead of making you wait at every one |
| **dismissal** | leaving the control, any click, any key, the window losing focus, a resize, or one of the bar's panels opening |

The warm period is the part worth keeping whatever else changes — it is what
makes a dense row of glyphs feel readable rather than sticky.

**Please draw it in the turn-12 frames**, ideally on one of the trainer ones
with a tip open over a glyph. If tips should look different — a darker surface
than `--gutter`, an arrow, a different delay — say so; this is a developer's
guess like the Link toggle, and it is now on every screen.

---

## Appendix — small things already matched

Recorded so they do not come back as questions:

- The pad-layout panel's `top` is **23px from the chip**, not the 25px §4.2
  names. Both describe the same place: §4.2 measures from the 20px segment,
  the app anchors on the 16px chip inside it, and `11a` itself puts the panel
  23px below the chip's top.
- Note-letter ink is `#08131a` dark / `#f2f2f2` light, measured off `11e`.
- The overview strip's rows sit at 3 / 11 / 20 / 28 for four lanes in a 33px
  strip, last dot ending on 30 — matching `11b`'s eight-row spacing rule.
- Pads carry **no** duration on import: a drum has decayed long before you
  could let go of the pad, and GM clips write arbitrary note lengths. The
  renderers draw pad holds correctly if a lesson authors them, so `11b`/`11c`'s
  RIM hold is reachable — no built-in lesson uses one yet.
- The window floor came down from 1216 to **1111** now the instrument switch
  has left the trainer bar (see §5 — the first figure we quoted was 1082,
  measured before we noticed the Link toggle was missing from the browser).
