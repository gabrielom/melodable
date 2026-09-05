import { describe, expect, it } from "vitest";
import {
  BOTTOM_LINE_PITCH,
  FIGURE_BEAMS,
  FIGURE_BEATS,
  ACCIDENTAL_EM_CENTRE,
  MIN_NOTE_GAP_PX,
  NOTEHEAD_EM_CENTRE,
  NOTEHEAD_EM_HEIGHT,
  accidentalFor,
  keySignatureFor,
  signatureAlters,
  signatureMarks,
  spell,
  beamGroups,
  beatsOf,
  engraveOnsets,
  figureFor,
  ledgerSteps,
  sheetPxPerBeat,
  smallestGap,
  staffStep,
  type BeamCandidate,
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

describe("beamGroups", () => {
  const notes = (spec: Array<[number, BeamCandidate["figure"]]>): BeamCandidate[] =>
    spec.map(([beat, figure]) => ({ beat, figure }));

  it("beams a pair of eighths inside one beat", () => {
    const g = beamGroups(notes([[0, "eighth"], [0.5, "eighth"]]), 4);
    expect(g).toEqual([{ members: [0, 1], beams: 1 }]);
  });

  it("never beams across a beat line", () => {
    const g = beamGroups(notes([[0.5, "eighth"], [1, "eighth"]]), 4);
    // Two lone eighths, each keeping its own flag.
    expect(g).toEqual([]);
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
