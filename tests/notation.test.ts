import { describe, expect, it } from "vitest";
import {
  BOTTOM_LINE_PITCH,
  FIGURE_BEAMS,
  FIGURE_BEATS,
  ACCIDENTAL_EM_CENTRE,
  MIDDLE_LINE_STEP,
  STEM_EM_LEN,
  FLAG_EM_TIP,
  FLAG,
  stemsUp,
  BRACE_INK_EM,
  CLEF_INK_EM,
  CLEF_REF_EM,
  beamGroups,
  type BeamCandidate,
  NOTEHEAD_EM_DX,
  NOTEHEAD_EM_HALF_WIDTH,
  noteheadDx,
  MIN_NOTE_GAP_PX,
  NOTEHEAD_EM_CENTRE,
  NOTEHEAD_EM_HEIGHT,
  accidentalFor,
  degreeOf,
  degreeRowDrop,
  GRAND_STEP_OFFSET,
  onBassStaff,
  handSplit,
  MIDDLE_C_STEP,
  needsBassStaff,
  bassSignatureMarks,
  keyName,
  keySignatureFor,
  tonicLetter,
  signatureAlters,
  signatureMarks,
  spell,
  beatsOf,
  engraveOnsets,
  figureFor,
  ledgerSteps,
  sheetPxPerBeat,
  smallestGap,
  staffStep,
} from "@/engine/notation";

/**
 * These two came off the font binary — the glyph bounds of U+1D15D at
 * unitsPerEm 1000 — not out of the handoff, which asks to be checked rather
 * than copied. Replace the font and both have to be measured again.
 */
describe("the font's measured constants", () => {
  it("makes a notehead exactly one staff space tall", () => {
    expect(NOTEHEAD_EM_HEIGHT).toBeCloseTo(0.252, 3);
    // The scale factor the renderer sizes the glyph by.
    expect(17 / NOTEHEAD_EM_HEIGHT).toBeCloseTo(67.46, 1);
  });

  it("seats the notehead centre just above the baseline", () => {
    expect(NOTEHEAD_EM_CENTRE).toBeCloseTo(0.134, 3);
  });

  it("puts a bare head and a stem at the same width the glyph does", () => {
    // A chord's heads are drawn, a single note's comes from the font, and the
    // two sit side by side on one staff — so the drawn one has to be the same
    // size. Rasterised at the drawn size, a stemmed head spans 0.0519..0.3446em
    // about a centre of 0.1983, and the stem sits on that right edge.
    expect(NOTEHEAD_EM_HALF_WIDTH).toBeCloseTo(0.1464, 4);
    expect(NOTEHEAD_EM_HALF_WIDTH * 2).toBeCloseTo(0.3446 - 0.0519, 3);
    // Which is also the distance from the head's centre to its stem.
    expect(NOTEHEAD_EM_DX.stemmed - 0.0519).toBeCloseTo(NOTEHEAD_EM_HALF_WIDTH, 2);
  });

  it("puts a whole note's head further into its glyph box than a stemmed one", () => {
    // Handoff 11 §1.2's constant, and the anchor everything under a note is
    // placed from. The whole note's is measured off the font and agrees with
    // the handoff exactly; the stemmed one is corroborated by the half note,
    // whose head is the only stemmed contour separable from its stem.
    expect(NOTEHEAD_EM_DX.whole).toBeCloseTo(0.257, 4);
    expect(NOTEHEAD_EM_DX.stemmed).toBeCloseTo(0.2006, 4);
    expect(NOTEHEAD_EM_DX.whole).toBeGreaterThan(NOTEHEAD_EM_DX.stemmed);
  });

  it("gives every stemmed figure the same anchor, flags and all", () => {
    // The trap §1.2 names: an eighth's flag reaches right, so anything derived
    // from ink bounds would place its label pixels off a quarter's.
    const stemmed = ["half", "quarter", "eighth", "sixteenth", "thirtysecond"] as const;
    for (const f of stemmed) expect(noteheadDx(f)).toBe(NOTEHEAD_EM_DX.stemmed);
    expect(noteheadDx("whole")).toBe(NOTEHEAD_EM_DX.whole);
  });

  it("lines the sharp and the natural up with a notehead, and not the flat", () => {
    // Measured from each glyph's counter — the hole it encloses, which is the
    // part that sits on the line. Noto draws the sharp and the natural to
    // land level with a notehead, and it says so to three decimal places.
    expect(ACCIDENTAL_EM_CENTRE.sharp).toBeCloseTo(NOTEHEAD_EM_CENTRE, 3);
    expect(ACCIDENTAL_EM_CENTRE.natural).toBeCloseTo(NOTEHEAD_EM_CENTRE, 3);
    // The flat is the exception: its bowl hangs below a stem that rises out
    // of the way, so centring it like the others lifts it off its own line.
    expect(ACCIDENTAL_EM_CENTRE.flat).toBeCloseTo(0.1175, 4);
    expect(ACCIDENTAL_EM_CENTRE.flat).toBeLessThan(NOTEHEAD_EM_CENTRE);
  });

  it("seats the bass clef on the midpoint of its two dots", () => {
    // The F clef decomposes into three contours: the hook, and two dots at
    // 0.700..0.809 and 0.480..0.589em. Their centres straddle the F line and
    // the line is the midpoint — the font saying where the clef points.
    expect(CLEF_REF_EM.bass).toBeCloseTo((0.7545 + 0.5345) / 2, 4);
    // The treble's reference is the notehead centre, like every other glyph.
    expect(CLEF_REF_EM.treble).toBe(NOTEHEAD_EM_CENTRE);
    // And the two are nowhere near each other, which is why one number for
    // both would have put the bass clef half a staff out.
    expect(CLEF_REF_EM.bass - CLEF_REF_EM.treble).toBeGreaterThan(0.5);
  });

  it("gives the bass clef more width than the treble, which the gutter pays for", () => {
    expect(CLEF_INK_EM.treble).toBeCloseTo(0.661, 4);
    expect(CLEF_INK_EM.bass).toBeCloseTo(0.742, 4);
    expect(CLEF_INK_EM.bass).toBeGreaterThan(CLEF_INK_EM.treble);
    // At the drawn staff size that difference is real pixels, not rounding —
    // enough to put the first accidental of a signature on the clef.
    expect((CLEF_INK_EM.bass - CLEF_INK_EM.treble) * (17 / NOTEHEAD_EM_HEIGHT)).toBeGreaterThan(5);
  });

  it("makes the brace fill its em box, and start right of its own pen", () => {
    // Top to bottom exactly, which is what lets the renderer size it by the
    // system's height and drop it on both outer staff lines with no fudge.
    expect(BRACE_INK_EM.top - BRACE_INK_EM.bottom).toBe(1);
    // And the left bearing, which is the one that was dropped: the ink is
    // 0.161em wide but its right edge is 0.211em from the pen.
    expect(BRACE_INK_EM.x1 - BRACE_INK_EM.x0).toBeCloseTo(0.161, 4);
    expect(BRACE_INK_EM.x0).toBeGreaterThan(0);
  });

  it("takes the stem's length off the font, not a round number", () => {
    // The composed quarter's ink stops at 1.009em and the notehead centre is
    // at 0.134em, so the font's own stem is the difference — 3.47 staff
    // spaces, which is the 3.5 engraving asks for. The drawn stems used a
    // flat 32px, under two spaces, so a chord's stem was little over half the
    // one on the single note beside it.
    expect(STEM_EM_LEN).toBeCloseTo(0.875, 3);
    expect(STEM_EM_LEN * (17 / NOTEHEAD_EM_HEIGHT)).toBeCloseTo(59, 0);
    expect(STEM_EM_LEN * (17 / NOTEHEAD_EM_HEIGHT) / 17).toBeGreaterThan(3.4);
    // The flag meets the stem at the same tip the stem is measured to.
    expect(FLAG_EM_TIP).toBeCloseTo(STEM_EM_LEN + NOTEHEAD_EM_CENTRE, 6);
  });

  it("has a combining flag for every figure that carries one", () => {
    // Indexed by beam count, so FIGURE_BEAMS reads straight into it.
    for (const figure of ["eighth", "sixteenth", "thirtysecond"] as const) {
      expect(FLAG[FIGURE_BEAMS[figure]]).toBeTruthy();
    }
    expect(FLAG[FIGURE_BEAMS.quarter]).toBe("");
  });
});

describe("stemsUp", () => {
  // Steps are positions on the note's own staff: 0 is the bottom line, 8 the
  // top, and MIDDLE_LINE_STEP the line the rule turns on.
  it("puts the middle line on the third line", () => {
    expect(MIDDLE_LINE_STEP).toBe(4);
  });

  it("sends a low note's stem up and a high note's down", () => {
    expect(stemsUp([0])).toBe(true); // bottom line
    expect(stemsUp([3])).toBe(true); // just under the middle
    expect(stemsUp([8])).toBe(false); // top line
    expect(stemsUp([5])).toBe(false); // just over the middle
  });

  it("sends a note on the middle line down, which is the convention", () => {
    expect(stemsUp([MIDDLE_LINE_STEP])).toBe(false);
  });

  it("lets the note furthest from the middle decide a chord", () => {
    // Bottom note is four steps out, top note only one: the chord goes up.
    expect(stemsUp([0, 3, 5])).toBe(true);
    // And the reverse — the top note is furthest, so the chord goes down.
    expect(stemsUp([3, 5, 8])).toBe(false);
  });

  it("sends an evenly straddling chord down", () => {
    // Equally far either way is the genuinely ambiguous case, and notation
    // settles it downward rather than leaving it to the order of the notes.
    expect(stemsUp([2, 6])).toBe(false);
    expect(stemsUp([6, 2])).toBe(false);
    expect(stemsUp([0, 8])).toBe(false);
  });

  it("answers for an empty set without throwing", () => {
    // Never reached — a column is built from at least one note — but a
    // Math.min over nothing is -Infinity and would place a stem off-screen.
    expect(stemsUp([])).toBe(true);
  });

  it("holds below the staff and above it", () => {
    expect(stemsUp([-6])).toBe(true); // well below, on ledgers
    expect(stemsUp([14])).toBe(false); // well above
  });
});

describe("figureFor", () => {
  it("names the plain values", () => {
    expect(figureFor(4)).toEqual({ figure: "whole", dotted: false });
    expect(figureFor(2)).toEqual({ figure: "half", dotted: false });
    expect(figureFor(1)).toEqual({ figure: "quarter", dotted: false });
    expect(figureFor(0.5)).toEqual({ figure: "eighth", dotted: false });
    expect(figureFor(0.25)).toEqual({ figure: "sixteenth", dotted: false });
  });

  it("names the dotted ones", () => {
    expect(figureFor(3)).toEqual({ figure: "half", dotted: true });
    expect(figureFor(1.5)).toEqual({ figure: "quarter", dotted: true });
    expect(figureFor(0.75)).toEqual({ figure: "eighth", dotted: true });
  });

  it("draws a zero-length note as a quarter rather than dropping it", () => {
    // Every pad lesson: a drum has decayed before you could let go.
    expect(figureFor(0)).toEqual({ figure: "quarter", dotted: false });
    expect(figureFor(-1)).toEqual({ figure: "quarter", dotted: false });
  });

  it("picks the nearest drawable value for a length notation cannot spell", () => {
    // Nothing is exactly 1.2 beats; a quarter is nearer than a dotted quarter.
    expect(figureFor(1.2).figure).toBe("quarter");
    expect(figureFor(1.4)).toEqual({ figure: "quarter", dotted: true });
  });

  it("round-trips every value it can name", () => {
    for (const [figure, beats] of Object.entries(FIGURE_BEATS)) {
      expect(figureFor(beats)).toEqual({ figure, dotted: false });
      expect(figureFor(beats * 1.5)).toEqual({ figure, dotted: true });
    }
  });

  it("agrees with beatsOf", () => {
    for (const b of [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25]) {
      expect(beatsOf(figureFor(b))).toBeCloseTo(b, 9);
    }
  });
});

describe("staffStep", () => {
  it("puts E4 on the bottom line", () => {
    expect(staffStep(BOTTOM_LINE_PITCH)).toBe(0);
  });

  it("walks diatonically, not chromatically", () => {
    expect(staffStep(65)).toBe(1); // F4, the space above
    expect(staffStep(66)).toBe(1); // F#4 shares F's position
    expect(staffStep(67)).toBe(2); // G4, second line
  });

  it("places the landmarks the handoff names", () => {
    expect(staffStep(67)).toBe(2); // G4 on the second line
    expect(staffStep(72)).toBe(5); // C5 in the third space
    expect(staffStep(60)).toBe(-2); // C4 one ledger below
  });

  it("puts F5 on the top line", () => {
    expect(staffStep(77)).toBe(8);
  });

  it("keeps an octave exactly seven steps", () => {
    expect(staffStep(76) - staffStep(64)).toBe(7);
  });
});

describe("accidentalFor", () => {
  it("marks the raised notes and nothing else", () => {
    expect(accidentalFor(61)).toBe("sharp"); // C#
    expect(accidentalFor(66)).toBe("sharp"); // F#
    expect(accidentalFor(60)).toBeNull(); // C
    expect(accidentalFor(64)).toBeNull(); // E
  });

  it("agrees with the position: a sharp shares its natural's step", () => {
    for (let p = 60; p < 84; p++) {
      if (accidentalFor(p) === "sharp") expect(staffStep(p)).toBe(staffStep(p - 1));
    }
  });
});

describe("ledgerSteps", () => {
  it("asks for none inside the staff", () => {
    for (const step of [0, 2, 4, 6, 8, 1, 7]) expect(ledgerSteps(step)).toEqual([]);
  });

  it("gives C4 a single line below", () => {
    expect(ledgerSteps(-2)).toEqual([-2]);
  });

  it("gives the note in the space below that same one line", () => {
    // B3 hangs under the ledger it shares with C4.
    expect(ledgerSteps(-3)).toEqual([-2]);
  });

  it("stacks them going further out", () => {
    expect(ledgerSteps(-4)).toEqual([-2, -4]);
    expect(ledgerSteps(10)).toEqual([10]);
    expect(ledgerSteps(13)).toEqual([10, 12]);
  });
});

describe("the sheet zoom", () => {
  it("leaves a lesson of quarters at the roll's zoom", () => {
    expect(sheetPxPerBeat(1, 64)).toBe(64);
  });

  it("zooms in until sixteenths clear the notehead", () => {
    // 64px per beat puts sixteenths 16px apart, which collides at 22px wide.
    const px = sheetPxPerBeat(0.25, 64);
    expect(px).toBe(MIN_NOTE_GAP_PX / 0.25);
    expect(px * 0.25).toBeGreaterThanOrEqual(MIN_NOTE_GAP_PX);
  });

  it("never zooms out below the roll, however sparse the lesson", () => {
    expect(sheetPxPerBeat(4, 64)).toBe(64);
  });

  it("has an answer for a lesson with one note", () => {
    expect(sheetPxPerBeat(0, 64)).toBe(64);
  });

  it("clears every built-in note spacing it is given", () => {
    for (const gap of [1, 0.5, 0.25]) {
      expect(sheetPxPerBeat(gap, 64) * gap).toBeGreaterThanOrEqual(MIN_NOTE_GAP_PX);
    }
  });
});

describe("smallestGap", () => {
  it("finds the closest pair", () => {
    expect(smallestGap([0, 1, 1.25, 3])).toBeCloseTo(0.25, 9);
  });

  it("ignores notes struck together, which do not crowd each other", () => {
    // A chord is one column, not two neighbours.
    expect(smallestGap([0, 0, 0, 2])).toBe(2);
  });

  it("has an answer for one note, or none", () => {
    expect(smallestGap([1])).toBe(0);
    expect(smallestGap([])).toBe(0);
  });
});

/**
 * The bug this fixes: `lessonTargets` zeroes any duration under the hold
 * floor, so every quaver reached the renderer as `duration: 0` and was drawn
 * as a crotchet — no flag, no beam, four times the music in a bar.
 */
describe("engraveOnsets", () => {
  const FLOOR = 0.75;
  const at = (spec: Array<[number, number]>) => spec.map(([beat, duration]) => ({ beat, duration }));

  it("reads a bar of quavers as quavers, not crotchets", () => {
    // What an imported eighth-note run actually looks like after the floor.
    const notes = at([[0, 0], [0.5, 0], [1, 0], [1.5, 0], [2, 0], [2.5, 0], [3, 0], [3.5, 0]]);
    const v = engraveOnsets(notes, 4, FLOOR);
    for (const beat of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
      expect(v.get(beat)).toEqual({ figure: "eighth", dotted: false });
    }
  });

  it("reads a bar of crotchets as crotchets", () => {
    const v = engraveOnsets(at([[0, 0], [1, 0], [2, 0], [3, 0]]), 4, FLOOR);
    for (const beat of [0, 1, 2, 3]) {
      expect(v.get(beat)).toEqual({ figure: "quarter", dotted: false });
    }
  });

  it("keeps a written length that survived the floor", () => {
    // A half note is a real hold and says so itself.
    const v = engraveOnsets(at([[0, 2], [2, 2]]), 4, FLOOR);
    expect(v.get(0)).toEqual({ figure: "half", dotted: false });
  });

  it("runs the last onset to the end of the loop", () => {
    expect(engraveOnsets(at([[0, 0], [3.5, 0]]), 4, FLOOR).get(3.5)).toEqual({
      figure: "eighth",
      dotted: false,
    });
    expect(engraveOnsets(at([[0, 0], [3, 0]]), 4, FLOOR).get(3)).toEqual({
      figure: "quarter",
      dotted: false,
    });
  });

  it("gives a chord one value, spoken for by its longest note", () => {
    const v = engraveOnsets(at([[0, 2], [0, 0], [0, 1]]), 4, FLOOR);
    expect(v.size).toBe(1);
    expect(v.get(0)).toEqual({ figure: "half", dotted: false });
  });

  it("reads sixteenths as sixteenths", () => {
    const v = engraveOnsets(at([[0, 0], [0.25, 0], [0.5, 0], [0.75, 0]]), 4, FLOOR);
    expect(v.get(0)).toEqual({ figure: "sixteenth", dotted: false });
    // The last of the run still runs to the next onset, not to the bar end.
    expect(v.get(0.5)).toEqual({ figure: "sixteenth", dotted: false });
  });

  it("reads a dotted-quaver against a semiquaver", () => {
    const v = engraveOnsets(at([[0, 0], [0.75, 0]]), 4, FLOOR);
    expect(v.get(0)).toEqual({ figure: "eighth", dotted: true });
  });

  it("never lets a written length outrun the loop", () => {
    const v = engraveOnsets(at([[0, 99]]), 4, FLOOR);
    expect(v.get(0)).toEqual({ figure: "whole", dotted: false });
  });

  it("has an answer for an empty loop", () => {
    expect(engraveOnsets([], 4, FLOOR).size).toBe(0);
  });
});

// ------------------------------------------------------------ key signature

/** Pitch classes of a scale, from a tonic and the major pattern. */
const major = (tonic: number) => [0, 2, 4, 5, 7, 9, 11].map((s) => 60 + tonic + s);

describe("signatureMarks", () => {
  it("draws nothing at all for C", () => {
    expect(signatureMarks(0)).toEqual([]);
  });

  it("puts E major's four sharps where an engraver puts them", () => {
    // F♯ top line, C♯ third space, G♯ above the staff, D♯ fourth line — the
    // shape a reader recognises before reading any of them.
    expect(signatureMarks(4)).toEqual([
      { step: 8, accidental: "sharp" },
      { step: 5, accidental: "sharp" },
      { step: 9, accidental: "sharp" },
      { step: 6, accidental: "sharp" },
    ]);
  });

  it("puts B♭ major's two flats on B and E", () => {
    expect(signatureMarks(-2)).toEqual([
      { step: 4, accidental: "flat" },
      { step: 7, accidental: "flat" },
    ]);
  });

  it("keeps every accidental within reach of the staff", () => {
    // Ledger lines in a signature would be an engraving error; the positions
    // are chosen so all seven sit on or just above the five lines.
    for (let f = -7; f <= 7; f++) {
      for (const m of signatureMarks(f)) {
        expect(m.step).toBeGreaterThanOrEqual(0);
        expect(m.step).toBeLessThanOrEqual(9);
      }
    }
  });

  it("grows one accidental at a time, keeping the ones before it", () => {
    for (let f = 1; f <= 7; f++) {
      expect(signatureMarks(f)).toHaveLength(f);
      expect(signatureMarks(f).slice(0, f - 1)).toEqual(signatureMarks(f - 1));
      expect(signatureMarks(-f).slice(0, f - 1)).toEqual(signatureMarks(-(f - 1)));
    }
  });
});

describe("keySignatureFor", () => {
  it("finds E major from the notes of E major", () => {
    // The case this was built for: an imported clip in four sharps.
    expect(keySignatureFor(major(4))).toBe(4);
  });

  it("finds the signature of every major key from its own scale", () => {
    // Five each way. Beyond that the signatures start meeting their own
    // enharmonic twins, which is the next test.
    for (let fifths = -5; fifths <= 5; fifths++) {
      // Tonic of the major key with this signature, as a pitch class.
      const tonic = ((fifths * 7) % 12 + 12) % 12;
      expect(keySignatureFor(major(tonic))).toBe(fifths);
    }
  });

  it("takes the simpler of two signatures that sound the same", () => {
    // C♯ major and D♭ major are the same seven keys on the controller. Seven
    // sharps or five flats, and nobody writes the seven.
    expect(keySignatureFor(major(1))).toBe(-5);
    // At six each way there is nothing to choose on count, and the tie is
    // settled toward sharps rather than by whichever was tested first.
    expect(keySignatureFor(major(6))).toBe(6);
  });

  it("reads the relative minor as the same signature, there being one", () => {
    // A natural minor is C major's seven pitch classes from a different
    // tonic, and a signature cannot tell the two apart — nor need it.
    const aMinor = [0, 2, 3, 5, 7, 8, 10].map((s) => 69 + s);
    expect(keySignatureFor(aMinor)).toBe(0);
    // Likewise C♯ minor, which is the minor of the case this was built for.
    const cSharpMinor = [0, 2, 3, 5, 7, 8, 10].map((s) => 61 + s);
    expect(keySignatureFor(cSharpMinor)).toBe(4);
  });

  it("stays in C for a fragment that fits several keys equally", () => {
    // A bare C major triad is diatonic to C, F and G alike. The tie goes to
    // the plainest, not to whichever was tried first.
    expect(keySignatureFor([60, 64, 67])).toBe(0);
  });

  it("is not swayed by one passing accidental", () => {
    // Notes are counted, not pitch classes, so a single chromatic cannot
    // outvote a tonic that sounds twenty times.
    const cMajor = Array.from({ length: 20 }, (_, i) => major(0)[i % 7]);
    expect(keySignatureFor([...cMajor, 61])).toBe(0);
  });

  it("has an answer for a lesson with no notes", () => {
    expect(keySignatureFor([])).toBe(0);
  });

  it("never picks a key that costs more accidentals than another", () => {
    const notes = major(4);
    const cost = (fifths: number) =>
      notes.filter((p) => spell(p, fifths).accidental !== null).length;
    const chosen = keySignatureFor(notes);
    for (let f = -7; f <= 7; f++) expect(cost(chosen)).toBeLessThanOrEqual(cost(f));
  });
});

describe("spell", () => {
  it("agrees with the C-major answer when there is no signature", () => {
    // `staffStep` and `accidentalFor` are the old, key-less pair. In C they
    // are still right, and this pins that nothing moved for existing lessons.
    for (let p = 36; p <= 96; p++) {
      expect(spell(p, 0)).toEqual({ step: staffStep(p), accidental: accidentalFor(p) });
    }
  });

  it("draws E major's own notes bare — the whole point of a signature", () => {
    for (const p of major(4)) expect(spell(p, 4).accidental).toBeNull();
  });

  it("keeps a sharpened note on its unaltered letter", () => {
    // F♯5 in E major sits on the top line, where F sits, and takes nothing.
    expect(spell(78, 4)).toEqual({ step: 8, accidental: null });
    // In C it is the same line, but now it has to say so.
    expect(spell(78, 0)).toEqual({ step: 8, accidental: "sharp" });
  });

  it("asks for a natural where the signature would sharpen", () => {
    // F♮5 in E major: the signature says F♯, so the F has to be cancelled.
    expect(spell(77, 4)).toEqual({ step: 8, accidental: "natural" });
  });

  it("spells a flat key with flats, not their sharp equivalents", () => {
    // B♭4 in F major is a B on the third line, covered by the signature —
    // not the A♯ the key-less spelling gave it.
    expect(spell(70, -1)).toEqual({ step: 4, accidental: null });
    expect(spell(70, 0).accidental).toBe("sharp");
  });

  it("lands every pitch on a line or space the signature agrees with", () => {
    // Round trip: whatever it spells, reading the staff position and the
    // accidental back has to give the pitch that went in.
    const semitone = { sharp: 1, flat: -1, natural: 0, null: 0 } as const;
    for (let fifths = -7; fifths <= 7; fifths++) {
      const alters = signatureAlters(fifths);
      for (let pitch = 36; pitch <= 96; pitch++) {
        const { step, accidental } = spell(pitch, fifths);
        // Step back to a letter and octave, then to a sounding pitch.
        const diatonic = step + 30; // bottom line E4 is diatonic 30
        const letter = ((diatonic % 7) + 7) % 7;
        const octave = Math.floor(diatonic / 7);
        const natural = (octave + 1) * 12 + [0, 2, 4, 5, 7, 9, 11][letter];
        const alter = accidental === null ? alters[letter] : semitone[accidental];
        expect(natural + alter).toBe(pitch);
      }
    }
  });

  it("never draws an accidental a note does not need", () => {
    // In its own key every scale degree is bare; the count of accidentals in
    // a scale is exactly zero, whatever the key.
    for (let fifths = -7; fifths <= 7; fifths++) {
      const tonic = ((fifths * 7) % 12 + 12) % 12;
      for (const p of major(tonic)) expect(spell(p, fifths).accidental).toBeNull();
    }
  });
});

// ------------------------------------------------------------- degree mode

describe("degreeOf", () => {
  it("numbers a major scale 1 through 7 from its own tonic", () => {
    for (let fifths = -5; fifths <= 5; fifths++) {
      const tonic = ((fifths * 7) % 12 + 12) % 12;
      const scale = [0, 2, 4, 5, 7, 9, 11].map((s) => 60 + tonic + s);
      scale.forEach((p, i) => {
        expect(degreeOf(p, fifths)).toEqual({ degree: i + 1, alter: 0 });
      });
    }
  });

  it("gives the same degree at every octave", () => {
    for (const oct of [-24, -12, 0, 12, 24]) {
      expect(degreeOf(64 + oct, 0).degree).toBe(3); // E is 3 in C
    }
  });

  it("raises and lowers against the scale, not against the letter", () => {
    // C major: C♯ is the tonic raised.
    expect(degreeOf(61, 0)).toEqual({ degree: 1, alter: 1 });
    expect(degreeOf(68, 0)).toEqual({ degree: 5, alter: 1 }); // G♯
    // E major: the signature makes F♯ the second degree, so an F natural —
    // which notation writes with a *natural* sign — is a flattened second.
    expect(spell(77, 4).accidental).toBe("natural");
    expect(degreeOf(77, 4)).toEqual({ degree: 2, alter: -1 });
  });

  it("never invents a degree outside 1..7 or an alteration beyond a semitone", () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (let p = 36; p <= 96; p++) {
        const d = degreeOf(p, fifths);
        expect(d.degree).toBeGreaterThanOrEqual(1);
        expect(d.degree).toBeLessThanOrEqual(7);
        expect(Math.abs(d.alter)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("agrees with the staff about which line the note is on", () => {
    // Both labellings read the same letter, so they can never disagree about
    // a note's identity — only about how it is named.
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (let p = 55; p <= 84; p++) {
        const letter = ((spell(p, fifths).step + 30) % 7 + 7) % 7;
        const expected = ((letter - tonicLetter(fifths)) % 7 + 7) % 7 + 1;
        expect(degreeOf(p, fifths).degree).toBe(expected);
      }
    }
  });
});

describe("tonicLetter and keyName", () => {
  it("walks the circle four letters at a time, both ways", () => {
    expect(tonicLetter(0)).toBe(0); // C
    expect(tonicLetter(1)).toBe(4); // G
    expect(tonicLetter(4)).toBe(2); // E — the key this was built for
    expect(tonicLetter(-1)).toBe(3); // F
    expect(tonicLetter(-2)).toBe(6); // B (flat)
  });

  it("names the signature the way the chip writes it", () => {
    expect(keyName(0)).toBe("C maj");
    expect(keyName(4)).toBe("E maj");
    expect(keyName(-1)).toBe("F maj");
    expect(keyName(-5)).toBe("Db maj");
  });

  it("has a name for every signature and clamps beyond them", () => {
    for (let f = -7; f <= 7; f++) expect(keyName(f)).toMatch(/^[A-G][b#]? maj$/);
    expect(keyName(99)).toBe(keyName(7));
    expect(keyName(-99)).toBe(keyName(-7));
  });
});

describe("beamGroups", () => {
  const notes = (spec: Array<[number, BeamCandidate["figure"]]>): BeamCandidate[] =>
    spec.map(([beat, figure]) => ({ beat, figure }));

  it("beams a pair of eighths inside one beat", () => {
    const g = beamGroups(notes([[0, "eighth"], [0.5, "eighth"]]), 4);
    expect(g).toEqual([{ members: [0, 1], beams: 1 }]);
  });

  it("beams a run of eighths in fours, across the beat line", () => {
    // Printed music beams running quavers to the half-bar, not the beat — the
    // beat-by-beat version comes out as a row of two-note groups and is what
    // made the trainer's staff not read like a piano part.
    const g = beamGroups(
      notes([[0, "eighth"], [0.5, "eighth"], [1, "eighth"], [1.5, "eighth"]]),
      4,
    );
    expect(g).toEqual([{ members: [0, 1, 2, 3], beams: 1 }]);
  });

  it("beams two eighths that straddle a beat line inside one half-bar", () => {
    // The consequence of the rule above, and the reason a lone run is carried
    // as far as the join: neither of these fills its own beat.
    const g = beamGroups(notes([[0.5, "eighth"], [1, "eighth"]]), 4);
    expect(g).toEqual([{ members: [0, 1], beams: 1 }]);
  });

  it("never beams across the half-bar", () => {
    // Which is the line the beat line used to be: a beam may cross beat 1 and
    // may not cross beat 2.
    expect(beamGroups(notes([[1.5, "eighth"], [2, "eighth"]]), 4)).toEqual([]);
    const full = beamGroups(
      notes([
        [0, "eighth"], [0.5, "eighth"], [1, "eighth"], [1.5, "eighth"],
        [2, "eighth"], [2.5, "eighth"], [3, "eighth"], [3.5, "eighth"],
      ]),
      4,
    );
    expect(full).toEqual([
      { members: [0, 1, 2, 3], beams: 1 },
      { members: [4, 5, 6, 7], beams: 1 },
    ]);
  });

  it("keeps sixteenths on the beat, where the subdivision has to read", () => {
    // Only plain eighths join. Eight sixteenths are two groups of four, not
    // one of eight — the join is deliberately the narrower rule.
    const g = beamGroups(
      notes([
        [0, "sixteenth"], [0.25, "sixteenth"], [0.5, "sixteenth"], [0.75, "sixteenth"],
        [1, "sixteenth"], [1.25, "sixteenth"], [1.5, "sixteenth"], [1.75, "sixteenth"],
      ]),
      4,
    );
    expect(g).toEqual([
      { members: [0, 1, 2, 3], beams: 2 },
      { members: [4, 5, 6, 7], beams: 2 },
    ]);
  });

  it("keeps a metre the half-bar does not divide on the beat", () => {
    // 3/4 has no half-bar to beam to, so the beat stands.
    const g = beamGroups(
      notes([[0, "eighth"], [0.5, "eighth"], [1, "eighth"], [1.5, "eighth"]]),
      3,
    );
    expect(g).toEqual([
      { members: [0, 1], beams: 1 },
      { members: [2, 3], beams: 1 },
    ]);
  });

  it("leaves a single eighth to its own flag", () => {
    expect(beamGroups(notes([[0, "eighth"]]), 4)).toEqual([]);
  });

  it("breaks a group on a quarter, which has no beam to share", () => {
    const g = beamGroups(
      notes([[0, "eighth"], [0.5, "eighth"], [1, "quarter"], [2, "eighth"], [2.5, "eighth"]]),
      4,
    );
    expect(g).toEqual([
      { members: [0, 1], beams: 1 },
      { members: [3, 4], beams: 1 },
    ]);
  });

  it("beams four sixteenths with two beams", () => {
    const g = beamGroups(
      notes([[0, "sixteenth"], [0.25, "sixteenth"], [0.5, "sixteenth"], [0.75, "sixteenth"]]),
      4,
    );
    expect(g).toEqual([{ members: [0, 1, 2, 3], beams: 2 }]);
  });

  it("shares only the beams the whole group carries", () => {
    // A dotted eighth and a sixteenth share one beam; the second's extra beam
    // is the broken stub handoff 10 §1.4.2 describes, drawn by the renderer.
    const g = beamGroups(notes([[0, "eighth"], [0.75, "sixteenth"]]), 4);
    expect(g).toEqual([{ members: [0, 1], beams: 1 }]);
  });

  it("never beams across a repeat, however the beats line up", () => {
    // The last eighth of one pass and the first of the next share a beat
    // index; without the loop they would be beamed into each other.
    const spanning = [
      { beat: 3.5, figure: "eighth" as const, loop: 0 },
      { beat: 3.5, figure: "eighth" as const, loop: 1 },
    ];
    expect(beamGroups(spanning, 4)).toEqual([]);
  });

  it("still beams within one repeat when the loop is given", () => {
    const g = beamGroups(
      [
        { beat: 0, figure: "eighth" as const, loop: 2 },
        { beat: 0.5, figure: "eighth" as const, loop: 2 },
      ],
      4,
    );
    expect(g).toEqual([{ members: [0, 1], beams: 1 }]);
  });

  it("counts beams per figure the way the font's flags do", () => {
    expect(FIGURE_BEAMS.quarter).toBe(0);
    expect(FIGURE_BEAMS.eighth).toBe(1);
    expect(FIGURE_BEAMS.sixteenth).toBe(2);
  });
});

describe("degreeRowDrop", () => {
  // The renderer's own numbers: half a 17px staff space, the handoff's 35px
  // drop, its own 3.5px of clearance and a 12px digit.
  const drop = (step: number) => degreeRowDrop(step, 8.5, 35, 3.5, 12);

  it("leaves the row where the handoff puts it when the music stays clear", () => {
    // Everything from C4 up, C4 included — its head bottoms out 25.5px down
    // and the row's box starts at 29. That the two meet exactly is why the
    // clearance is read off the handoff's drop instead of being chosen.
    for (const step of [0, 2, 4, 8, -1, -2]) expect(drop(step)).toBe(35);
  });

  it("pushes the row clear of a note that would sit on its own digit", () => {
    // A3 at step -4 puts its notehead *centre* 34px down, one pixel off the
    // row's centre — the collision this exists for.
    expect(drop(-4)).toBeGreaterThan(35);
    expect(drop(-3)).toBeGreaterThan(35);
  });

  it("moves no further than it has to", () => {
    // The head's bottom edge, the clearance, then half the digit.
    expect(drop(-4)).toBeCloseTo(4 * 8.5 + 8.5 + 3.5 + 6, 6);
  });

  it("treats C4 as the boundary the design's own number sets", () => {
    // One step lower and the row has to give; C4 itself never does.
    expect(drop(-2)).toBe(35);
    expect(drop(-3)).toBeGreaterThan(35);
  });

  it("keeps going down as the music does", () => {
    const deeper = [-4, -6, -8, -10].map(drop);
    for (let i = 1; i < deeper.length; i++) expect(deeper[i]).toBeGreaterThan(deeper[i - 1]);
  });

  it("is never above the handoff's own drop, however high the music sits", () => {
    for (const step of [10, 14, 20]) expect(drop(step)).toBe(35);
  });
});

describe("the grand staff", () => {
  it("puts the bass staff's bottom line twelve steps under the treble's", () => {
    // Treble bottom is E4, bass bottom is G2, and everything in this module
    // counts from E4 — so one `spell` answers for both staves.
    expect(GRAND_STEP_OFFSET).toBe(12);
    expect(staffStep(64) - staffStep(43)).toBe(GRAND_STEP_OFFSET); // E4 over G2
    // Which puts the bass staff's own five lines back at 0, 2, 4, 6, 8.
    for (const [pitch, line] of [[43, 0], [47, 2], [50, 4], [53, 6], [57, 8]] as const) {
      expect(staffStep(pitch) + GRAND_STEP_OFFSET).toBe(line);
    }
  });

  it("reads the hands' own dividing line off the moments they play together", () => {
    // The montuno from the printed piano part: G3 B3 C4 D4 in the left hand
    // against G4 B4 C5 D5 G5 in the right, one of each on every eighth. The
    // textbook C4 split sends the left hand's C4 and D4 up onto the treble
    // staff with the right hand, which is a grand staff that still reads like
    // one crowded one.
    //
    // What is pinned is the **division**, not the number: every line from E4
    // to G4 separates these hands identically, and which of them comes back
    // is a tie-break (nearest middle C) rather than a fact about the music.
    const lh = [55, 59, 60, 62, 55, 59, 60, 62];
    const rh = [67, 71, 72, 74, 67, 71, 72, 74];
    const notes = lh.flatMap((low, i) => [
      { time: i * 0.5, pitch: low },
      { time: i * 0.5, pitch: rh[i] },
    ]);
    const split = handSplit(notes);
    for (const p of lh) expect(onBassStaff(staffStep(p), split)).toBe(true);
    for (const p of rh) expect(onBassStaff(staffStep(p), split)).toBe(false);
    // And it has moved off C4, which is the whole point: at C4 the left
    // hand's own C4 and D4 would be drawn on the treble staff.
    expect(split).toBeGreaterThan(MIDDLE_C_STEP);
    expect(onBassStaff(staffStep(62), split)).toBe(true); // D4, left hand
    expect(onBassStaff(staffStep(62), MIDDLE_C_STEP)).toBe(false); // as it used to be
  });

  it("keeps middle C for a melody, which has no hands to divide", () => {
    const line = [60, 62, 64, 65, 67].map((pitch, i) => ({ time: i, pitch }));
    expect(handSplit(line)).toBe(MIDDLE_C_STEP);
    expect(handSplit([])).toBe(MIDDLE_C_STEP);
  });

  it("does not mistake a chord for two hands", () => {
    // A triad's internal gaps are thirds. Splitting inside one would put the
    // bottom of a chord on the other staff from its top.
    const triad = [60, 64, 67].map((pitch) => ({ time: 0, pitch }));
    expect(handSplit(triad)).toBe(MIDDLE_C_STEP);
  });

  it("finds the line under a left-hand chord, not inside it", () => {
    // C3-E3-G3 under a C5 melody: the only gap wide enough is the one
    // between the hands, so the chord stays whole on the bass staff.
    const notes = [48, 52, 55, 72].map((pitch) => ({ time: 0, pitch }));
    const split = handSplit(notes);
    for (const p of [48, 52, 55]) expect(onBassStaff(staffStep(p), split)).toBe(true);
    expect(onBassStaff(staffStep(72), split)).toBe(false);
  });

  it("holds still when one moment disagrees with the rest", () => {
    // Every bar of the montuno votes for G4; a single stray octave should not
    // move a line the whole piece is read against.
    const steady = Array.from({ length: 16 }, (_, i) => i).flatMap((i) => [
      { time: i * 0.5, pitch: 60 },
      { time: i * 0.5, pitch: 72 },
    ]);
    const before = handSplit(steady);
    expect(handSplit([...steady, { time: 99, pitch: 40 }, { time: 99, pitch: 41 }])).toBe(before);
  });

  it("splits the hands at middle C, which keeps its own ledger on the treble", () => {
    // The default when nothing says otherwise, which is still the classic line.
    expect(onBassStaff(staffStep(60))).toBe(false); // C4, one ledger below treble
    expect(onBassStaff(staffStep(62))).toBe(false); // D4
    expect(onBassStaff(staffStep(59))).toBe(true); // B3
    expect(onBassStaff(staffStep(48))).toBe(true); // C3
  });

  it("asks for a bass staff only when the music reaches past two ledgers", () => {
    // A melody that merely dips is better with a couple of ledger lines than
    // split across two staves — the imported No One bottoms out on exactly A3.
    expect(needsBassStaff([57, 64, 71])).toBe(false); // A3 is the limit
    expect(needsBassStaff([60, 64, 72])).toBe(false);
    expect(needsBassStaff([55, 64, 71])).toBe(true); // G3 is past it
    expect(needsBassStaff([48, 60, 72])).toBe(true);
  });

  it("asks for one when the music climbs off the top instead", () => {
    // The mirror of the rule above, and the case a two-hand piece trips when
    // its left hand never goes low: C6 is two ledgers up and is the limit,
    // and a montuno running B3 to G6 needs the second staff even though its
    // bottom note is only B3.
    expect(needsBassStaff([60, 72, 84])).toBe(false); // C6 is the limit
    expect(needsBassStaff([59, 72, 91])).toBe(true); // B3..G6
  });

  it("never draws a bass staff with nothing on it", () => {
    // Music living entirely above the treble staff is still too wide for it,
    // but a bass clef underneath would be empty — that wants ledger lines.
    expect(needsBassStaff([84, 88, 91])).toBe(false); // C6..G6, all high
    expect(needsBassStaff([72, 84, 91])).toBe(false); // C5..G6, still all above C4
  });

  it("wants none for an empty lesson", () => {
    expect(needsBassStaff([])).toBe(false);
  });

  it("writes the signature two steps lower in the bass clef", () => {
    // The F# on the treble's top line sits on the bass's fourth line, and the
    // rest follow it down by the same third.
    for (const fifths of [-7, -3, -1, 1, 4, 7]) {
      const treble = signatureMarks(fifths);
      const bass = bassSignatureMarks(fifths);
      expect(bass.length).toBe(treble.length);
      bass.forEach((m, i) => {
        expect(m.accidental).toBe(treble[i].accidental);
        expect(m.step).toBe(treble[i].step - 2);
      });
    }
  });

  it("keeps every bass-clef accidental on the staff", () => {
    // The marks come back in the bass staff's *own* coordinates, so its five
    // lines are 0, 2, 4, 6, 8 exactly as the treble's are — an accidental
    // outside that would be hanging off the staff.
    //
    // Up to six either way. The seventh flat is the one exception: the whole
    // signature is written a third lower and F♭ lands a space under the bottom
    // line. No lesson has ever derived seven flats — `keySignatureFor` picks
    // the cheapest signature the notes allow — and drawing it a space low is a
    // better failure than moving six correct accidentals to rescue one.
    for (let fifths = -6; fifths <= 6; fifths++) {
      for (const m of bassSignatureMarks(fifths)) {
        expect(m.step).toBeGreaterThanOrEqual(0);
        expect(m.step).toBeLessThanOrEqual(8);
      }
    }
  });
});
