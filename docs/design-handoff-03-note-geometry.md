# Handoff 03 — note geometry (app → design)

This one goes the other way. Handoffs 01 and 02 came from design to the app;
this records changes the app has made since, so the drawings can be brought
back into line. Everything in handoff 02 still holds except where contradicted
below.

Scope: **the size and shape of a note** in the four trainer frames — `10b pads
horizontal`, `10c pads vertical`, `10e piano horizontal`, `10f piano vertical`.
A short appendix lists other trainer-view changes that alter those frames, so
nothing is a surprise when you open them.

Every number here is a computed value read out of the running app, not an
intention.

---

## 1. The rule that did not change

A note is a **fixed pixel size**. It does not scale with the window, the lane
count, or the visible range. Only the *spacing between* notes scales, because
that comes from the five-bar zoom:

```
pxPerBeat = trackLength / (5 × beatsPerBar)
```

So the same note is drawn on a 1180px frame and a 2560px one; what changes is
how much air sits between consecutive notes. This matters for the drawings:
if a frame is a different width from the app's default window, note *spacing*
should differ but note *size* must not.

## 2. Pads — horizontal (`10b`)

| | was | now |
|---|---|---|
| shape | square | square |
| size | 14 × 14 | **28 × 28** |
| corner radius | `RADIUS.note` — dark 2, light 1 | unchanged |
| colour rule | LED ahead, rating behind | unchanged |

The height clamps to the lane if lanes ever get thin —
`min(28, max(5, laneHeight − 4))` — but at any realistic lane count it draws
the full 28. The width never clamps.

## 3. Pads — vertical (`10c`)

| | was | now |
|---|---|---|
| shape | pill | pill |
| height | 8 | **16** |
| corner radius | 4 (half the height) | **8** (half the height) |
| max width | 72 | **144** |
| inset from column | 12 either side | unchanged |

Width is `min(144, columnWidth − 2 × inset)`, then **centred in the column**.
The cap is what stops a two-lane lesson drawing a 600px slab: without it the
note insets from a column half the window wide and stops reading as a note.
Centring is what makes the cap look deliberate rather than left-aligned.

## 4. Piano — both orientations: the pill is now a **circle**

This is the substantive change. Both piano frames used a pill; both now use a
circle of a single diameter.

| | was (vertical) | was (horizontal) | now (both) |
|---|---|---|---|
| shape | pill | pill | **circle** |
| size | 16 tall, ≤72 wide | 16 wide × 26 tall | **26 diameter** |
| radius | 8 | 13 | **13** (half the diameter) |
| centred on | its key column | its row, inset | **its key column / its row centre** |

- **Vertical** (`10f`): diameter is `min(26, keyWidth − 2)`, so on a range wide
  enough to squeeze the black keys the circle shrinks to stay inside its own
  column rather than spilling over its neighbours.
- **Horizontal** (`10e`): diameter is a flat 26 and is *deliberately larger
  than a row*. Rows are thin over a two-octave range, so neighbouring
  semitones overlap slightly — this is the same behaviour the old pill had and
  matches how Melodics reads.

### Radius clamping — please carry this rule into the drawings

A corner radius is clamped to **half the shorter side**. Asking for more does
not produce a rounder box: the corner arcs overlap, the outline doubles back,
and you get a pointed lens with a spike off each end. The old 16 × 26 piano
pill asked for a radius of 13 on a 16-wide box and drew exactly that artifact
for a while. Native `roundRect` and CSS `border-radius` both clamp; the app
now does too.

## 5. The letter inside a piano note

| | was | now |
|---|---|---|
| text | `C4` — letter and octave | **`C`** — letter only |
| size | 8.5px | **17px** |
| weight | 500 medium | **700 bold** |
| accidental | same size as the letter | **11px, raised 4px, 1px gap** |
| face | Geist Mono | unchanged |
| colour | light `#e9e9ea`, dark `#0b0b0c` | unchanged |

The octave went because the note already sits over its own key: the position
says which octave, so printing it was saying the same thing twice. **The
keyboard still names its keys in full** (`C4`, `E4`, `G4`) — that is where the
octave belongs, and it is unchanged.

**A sharp is set as an accidental, not as a second letter.** `C#` is a 17px
bold `C` with an 11px `#` beside it, raised 4px, 1px of gap, and the pair
centred in the circle as a unit. The accidental qualifies the letter rather
than standing beside it as an equal — which is also how it is set in type.

This is what resolved the crowding: at one size the pair measured 20.4px in a
26px circle, roughly a pixel of clearance at the widest point. Set as an
accidental it measures **17.8px** — 10.2 of letter, 1 of gap, 6.6 of sharp —
so a sharp note now sits as comfortably in its circle as a natural one.

**Dropped when it will not fit.** Below a **22px** circle the label is not
drawn at all rather than spilled outside it, derived from that 17.8px plus a
couple of pixels either side. It was 25 while the sharp was full size. In
practice this only triggers on an imported clip wide enough to squeeze the
black keys.

## 6. Consequence: notes touch sooner

Doubling the pads note and enlarging the piano note enlarged their extent
along the **time** axis too, not just their visual bulk. Consecutive notes now
touch or overlap at a spacing where they used to clear:

Measured at a 1280 × 800 window in 4/4 — the app's default, and the size the
frames should be read against:

| frame | px per beat | eighth | note along time | eighths |
|---|---|---|---|---|
| piano horizontal | 60.4 | 30.2px | 26px wide | clear by 4.2px |
| pads horizontal | 57.0 | 28.5px | 28px wide | clear by 0.5px |
| pads vertical | 34.3 | 17.1px | 16px tall | clear by 1.1px |
| piano vertical | 28.7 | 14.3px | 26px tall | **overlap by 11.7px** |

The vertical piano roll is the one to look at. Its field is the short axis of
the window, so it has half the spacing the horizontal roll does: eighths
overlap by nearly half a circle, and even **quarter notes clear by only
2.7px**. A dense imported clip will read there as a chain rather than as
separate notes.

This is accepted rather than a defect — the note has to read first, and no
built-in lesson runs sixteenths — but the drawings should show it honestly
rather than at an idealised spacing. See the open questions.

---

## Appendix — other trainer-view changes since handoff 02

Not note geometry, but they change what these frames look like, so the
drawings will not match without them.

1. **Piano visible range: three octaves → two.** Plus three semitones of air
   either side of the lesson's own pitches. Three octaves left most of the
   roll empty for a five-note lesson, and the empty rows were what made keys
   wide enough to turn notes into slabs. This is why the circle needed a cap
   at all.

2. **Count-in no longer dims the lane.** `10g count-in` had a 60% wash over
   the whole canvas behind the rings. It greyed out the notes you are counting
   yourself in to play, so it is gone — rings and title draw straight over an
   undimmed lane.

3. **A stopped lesson previews itself.** The lane is no longer empty before
   Start. It draws the run parked one count-in *before* beat 0 — the exact
   position the transport starts at — so pressing Start moves nothing and the
   notes simply begin to travel. There is no "empty trainer" state left to
   draw.

4. **The played-side veil is only drawn while running.** Nothing has been
   played before Start, so the preview has no wash behind the playhead.

5. **"PRESS START FOR THE COUNT-IN" is gone.** The preview says it better.

6. **The vertical piano playhead was wrong and is now fixed.** The app had it
   centred in the roll; `10f` puts it 108px up from the roll's bottom — 211 of
   a 319px roll. It now reads from a fixed offset, the same shape of rule the
   pads view already used for its own 76px. Nothing to change in the drawings;
   the app has come to them.

   Note that this is a *fixed* offset rather than a fraction of the roll, so
   the landing strip below the line stays the same size at any window height.
   Every frame is 500px tall, so the drawings cannot distinguish the two — if
   it was meant to be proportional, say so.

## Open questions for design

1. ~~Sharps in a 26px circle~~ — **resolved**: the accidental is set smaller
   and raised (§5), which brings the label from 20.4px to 17.8px and makes the
   question moot.
2. **Vertical piano overlap** (§6) — quarters clear by 2.7px and eighths
   overlap by 11.7px, because that roll has half the spacing the horizontal
   one does. Accept the chaining, shrink the circle on the time axis only
   (making it an ellipse), or give the vertical roll a smaller diameter than
   the horizontal one?
3. **Pads horizontal is a 28px square with a 1–2px corner.** At double the old
   size, is that still the right corner treatment, or should it round more?

4. **The horizontal playhead sits in a different place in the drawings than in
   the app, and has been left alone deliberately.** Both `10b` and `10e` put
   it at x=590 — dead centre of the 1180px *frame*. The piano matches, having
   no gutter. The pads view does not: it centres the line on the *track*,
   after the 128px label gutter, which lands at 654. So the drawing gives the
   pads view 462px of history and 590px of future, where the app gives it 526
   of each. Which is intended? The app's version is being kept until you say
   otherwise.
